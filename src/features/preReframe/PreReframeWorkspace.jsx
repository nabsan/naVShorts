import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, Play, Save, Upload, Wand2 } from "lucide-react";

import { hasTauri, invoke, toVideoSrc } from "../../lib/tauri";

const SETTINGS_KEY = "naVShorts.reframeAssist.v5";
const DEFAULT_FACE_FOLDER = "S:\\tools\\codex\\waka_images";

const DEFAULT_CONFIG = {
  targetFaceFolder: DEFAULT_FACE_FOLDER,
  assistJsonDir: "",
  previewProxyDir: "",
  configPath: "",
  defaultAssistTrackingEngine: "yoloBytetrackArcface",
};

const PLAYBACK_OPTIONS = ["0.5", "1", "1.5", "2", "3", "4"];
const ENGINE_OPTIONS = [
  { value: "none", label: "Manual only" },
  { value: "faceIdentity", label: "Assist with Face Identity (ONNX)" },
  { value: "yoloBytetrackArcface", label: "Assist with YOLO + ByteTrack + ArcFace" },
  { value: "yoloDeepsortPerson", label: "Assist with YOLO + DeepSORT" },
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function timestampYYMMDDhhmmss(d = new Date()) {
  return `${pad2(d.getFullYear() % 100)}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

function secondsLabel(sec) {
  const total = Math.max(0, sec || 0);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total - Math.floor(total)) * 100);
  return `${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
}

function directoryOf(pathValue) {
  const normalized = (pathValue || "").replace(/\//g, "\\");
  const lastSlash = normalized.lastIndexOf("\\");
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : "";
}

function buildJsonPath(inputFullPath, assistJsonDir) {
  const normalized = inputFullPath.replace(/\//g, "\\");
  const lastSlash = normalized.lastIndexOf("\\");
  const configuredDir = (assistJsonDir || "").trim();
  const baseDir = configuredDir ? configuredDir.replace(/\//g, "\\") : (lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : "");
  const dir = baseDir.endsWith("\\") ? baseDir : (baseDir ? `${baseDir}\\` : "");
  const file = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const dot = file.lastIndexOf(".");
  const base = dot > 0 ? file.slice(0, dot) : file;
  return `${dir}${base}_assist_${timestampYYMMDDhhmmss()}.json`;
}

function interpolateAnchorValue(a, b, key, u) {
  return a[key] + (b[key] - a[key]) * u;
}

function getDisplayRectAtTime(anchors, timeSec) {
  if (anchors.length === 0) return null;
  if (anchors.length === 1) return anchors[0];
  if (timeSec <= anchors[0].timeSec) return anchors[0];

  for (let i = 0; i < anchors.length - 1; i += 1) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (timeSec <= b.timeSec) {
      const dt = Math.max(0.001, b.timeSec - a.timeSec);
      const u = Math.min(Math.max((timeSec - a.timeSec) / dt, 0), 1);
      return {
        timeSec,
        centerXRatio: interpolateAnchorValue(a, b, "centerXRatio", u),
        rectXRatio: interpolateAnchorValue(a, b, "rectXRatio", u),
        rectYRatio: interpolateAnchorValue(a, b, "rectYRatio", u),
        rectWRatio: interpolateAnchorValue(a, b, "rectWRatio", u),
        rectHRatio: interpolateAnchorValue(a, b, "rectHRatio", u),
      };
    }
  }

  return anchors[anchors.length - 1];
}

function normalizeRect(rect) {
  const x = Math.min(rect.x, rect.x + rect.w);
  const y = Math.min(rect.y, rect.y + rect.h);
  const w = Math.abs(rect.w);
  const h = Math.abs(rect.h);
  return { x, y, w, h };
}

function ActionButton({ icon: Icon, children, className = "", ...props }) {
  return (
    <button
      {...props}
      className={`app-btn ${className}`}
    >
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-[#344054]">{label}</span>
      {children}
    </label>
  );
}

export default function PreReframeWorkspace({ onSendToReframe, onAssistStateChange, embedded = false }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [appConfig, setAppConfig] = useState(DEFAULT_CONFIG);
  const [sourceVideoPath, setSourceVideoPath] = useState("");
  const [assistJsonPath, setAssistJsonPath] = useState("");
  const [targetFacePath, setTargetFacePath] = useState(DEFAULT_FACE_FOLDER);
  const [assistTrackingEngine, setAssistTrackingEngine] = useState("yoloBytetrackArcface");
  const [stability, setStability] = useState(0.84);
  const [playbackRate, setPlaybackRate] = useState("1");
  const [showAllAnchors, setShowAllAnchors] = useState(false);
  const [videoInfo, setVideoInfo] = useState(null);
  const [anchors, setAnchors] = useState([]);
  const [status, setStatus] = useState({
    message: hasTauri() ? "Idle" : "Tauri API not available",
    tauriAvailable: hasTauri(),
    previewPath: "",
    videoSrc: "",
    previewInspect: null,
    fetch: null,
    events: [],
  });
  const [previewUrl, setPreviewUrl] = useState("");
  const [metaText, setMetaText] = useState("No video loaded.");
  const [dragRect, setDragRect] = useState(null);
  const [dragStart, setDragStart] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);

  const anchorJson = useMemo(
    () =>
      JSON.stringify(
        {
          sourceVideo: sourceVideoPath.trim() || null,
          targetFacePath: targetFacePath.trim() || null,
          assistTrackingEngine,
          anchors,
        },
        null,
        2,
      ),
    [anchors, assistTrackingEngine, sourceVideoPath, targetFacePath],
  );

  const pushEvent = useCallback((event, extra = {}) => {
    setStatus((prev) => ({
      ...prev,
      events: [...prev.events, { at: new Date().toISOString(), event, ...extra }].slice(-30),
    }));
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (typeof saved.stability === "number") setStability(saved.stability);
      if (typeof saved.playbackRate === "string") setPlaybackRate(saved.playbackRate);
      if (typeof saved.targetFacePath === "string" && saved.targetFacePath.trim()) setTargetFacePath(saved.targetFacePath);
      if (typeof saved.assistTrackingEngine === "string") setAssistTrackingEngine(saved.assistTrackingEngine);
      if (typeof saved.showAllAnchors === "boolean") setShowAllAnchors(saved.showAllAnchors);
    } catch {
      // ignore local settings failures
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        stability,
        playbackRate,
        targetFacePath,
        assistTrackingEngine,
        showAllAnchors,
      }),
    );
  }, [assistTrackingEngine, playbackRate, showAllAnchors, stability, targetFacePath]);

  useEffect(() => {
    let alive = true;
    invoke("get_app_config")
      .then((cfg) => {
        if (!alive) return;
        const nextConfig = {
          targetFaceFolder: cfg.targetFaceFolder || DEFAULT_FACE_FOLDER,
          assistJsonDir: cfg.assistJsonDir || "",
          previewProxyDir: cfg.previewProxyDir || "",
          configPath: cfg.configPath || "",
          defaultAssistTrackingEngine: cfg.preReframeDefaultEngine || "yoloBytetrackArcface",
        };
        setAppConfig(nextConfig);
        setTargetFacePath((current) => (current.trim() ? current : nextConfig.targetFaceFolder));
        setAssistTrackingEngine((current) => current || nextConfig.defaultAssistTrackingEngine);
      })
      .catch(() => {
        // ignore config load failures
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!sourceVideoPath.trim() || assistJsonPath.trim()) return;
    setAssistJsonPath(buildJsonPath(sourceVideoPath.trim(), appConfig.assistJsonDir));
  }, [appConfig.assistJsonDir, assistJsonPath, sourceVideoPath]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = Number(playbackRate || 1);
  }, [playbackRate]);

  useEffect(() => {
    if (!videoInfo) {
      setMetaText("No video loaded.");
      return;
    }
    setMetaText(
      `Video ${videoInfo.width}x${videoInfo.height} | ${videoInfo.fps.toFixed(2)} fps | duration ${secondsLabel(videoInfo.durationSec)} | anchors ${anchors.length}`,
    );
  }, [anchors.length, videoInfo]);

  useEffect(() => {
    onAssistStateChange?.({
      sourceVideoPath: sourceVideoPath.trim(),
      targetFacePath: targetFacePath.trim(),
      assistJsonPath: assistJsonPath.trim(),
      assistTrackingEngine,
      anchors,
    });
  }, [anchors, assistJsonPath, assistTrackingEngine, onAssistStateChange, sourceVideoPath, targetFacePath]);

  const redrawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = Math.round(video.clientWidth || video.getBoundingClientRect().width || 0);
    const height = Math.round(video.clientHeight || video.getBoundingClientRect().height || 0);
    if (width <= 0 || height <= 0) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    const drawRect = (anchor, stroke, fill, lineWidth = 2) => {
      if (!anchor) return;
      const x = anchor.rectXRatio * canvas.width;
      const y = anchor.rectYRatio * canvas.height;
      const w = anchor.rectWRatio * canvas.width;
      const h = anchor.rectHRatio * canvas.height;
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = stroke;
      ctx.fillStyle = fill;
      ctx.strokeRect(x, y, w, h);
      if (fill) ctx.fillRect(x, y, w, h);
    };

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (showAllAnchors) {
      anchors.forEach((anchor) => drawRect(anchor, "rgba(0,113,227,0.36)", "rgba(0,113,227,0.08)", 1.5));
    }

    drawRect(getDisplayRectAtTime(anchors, currentTime), "rgba(0,113,227,0.98)", "rgba(0,113,227,0.14)", 2.5);

    if (dragRect) {
      drawRect(
        {
          rectXRatio: dragRect.x / canvas.width,
          rectYRatio: dragRect.y / canvas.height,
          rectWRatio: dragRect.w / canvas.width,
          rectHRatio: dragRect.h / canvas.height,
        },
        "rgba(249,115,22,0.98)",
        "rgba(249,115,22,0.18)",
        2,
      );
    }
  }, [anchors, currentTime, dragRect, showAllAnchors]);

  useEffect(() => {
    redrawOverlay();
  }, [redrawOverlay]);

  useEffect(() => {
    const onResize = () => redrawOverlay();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [redrawOverlay]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.repeat) return;

      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
        return;
      }

      if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
        const video = videoRef.current;
        if (!video?.src) return;
        event.preventDefault();
        const delta = event.code === "ArrowLeft" ? -2 : 2;
        const duration = Number.isFinite(video.duration) ? video.duration : Number(videoInfo?.durationSec || 0);
        const maxTime = Math.max(0, duration - 0.001);
        const nextTime = Math.min(Math.max((video.currentTime || 0) + delta, 0), maxTime);
        video.currentTime = nextTime;
        video.pause();
        setCurrentTime(nextTime);
        redrawOverlay();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [redrawOverlay, videoInfo]);

  useEffect(() => () => {
    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const attachPreviewForSource = useCallback(
    async (sourcePath) => {
      setStatus((prev) => ({
        ...prev,
        message: "Creating preview proxy...",
        previewInspect: null,
        previewPath: "",
        videoSrc: "",
        fetch: null,
        events: [],
      }));

      const previewPath = await invoke("create_preview_video", { path: sourcePath });
      const assetSrc = toVideoSrc(previewPath);

      let previewInspect = null;
      try {
        previewInspect = await invoke("inspect_preview_video", { path: previewPath });
      } catch (error) {
        previewInspect = { inspectError: String(error) };
      }

      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }

      if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);

      let assignedSrc = assetSrc;
      let fetchState = null;

      try {
        const response = await fetch(assetSrc);
        const blob = await response.blob();
        assignedSrc = URL.createObjectURL(new Blob([blob], { type: "video/mp4" }));
        fetchState = {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get("content-type"),
          blobSize: blob.size,
          mode: "blob-url-fetch",
        };
      } catch (error) {
        try {
          const base64Payload = await invoke("read_preview_video_base64", { path: previewPath });
          const raw = atob(base64Payload.base64 || "");
          const bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
          assignedSrc = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
          fetchState = {
            mode: "blob-url-base64",
            blobSize: bytes.byteLength,
          };
        } catch (base64Error) {
          fetchState = {
            error: String(error),
            base64Error: String(base64Error),
            mode: "asset-url-fallback",
          };
        }
      }

      setPreviewUrl(assignedSrc);
      setStatus((prev) => ({
        ...prev,
        message: "Preview proxy attached.",
        previewPath,
        videoSrc: assetSrc,
        previewInspect,
        fetch: fetchState,
      }));
    },
    [previewUrl],
  );

  const openSourceVideo = async () => {
    try {
      const picked = await invoke("pick_video_file");
      if (!picked) {
        setStatus((prev) => ({ ...prev, message: "Video selection cancelled." }));
        return;
      }
      const info = await invoke("open_video", { path: picked });
      setVideoInfo(info);
      setSourceVideoPath(picked);
      setAssistJsonPath(buildJsonPath(picked, appConfig.assistJsonDir));
      setAnchors([]);
      await attachPreviewForSource(picked);
      setStatus((prev) => ({ ...prev, message: "Source video loaded for Reframe Assist." }));
    } catch (error) {
      setStatus((prev) => ({ ...prev, message: String(error) }));
    }
  };

  const pickTargetFaceFolder = async () => {
    try {
      const picked = await invoke("pick_folder_with_default", {
        startDir: targetFacePath.trim() || appConfig.targetFaceFolder || null,
      });
      if (!picked) {
        setStatus((prev) => ({ ...prev, message: "Face folder selection cancelled." }));
        return;
      }
      setTargetFacePath(picked);
      setStatus((prev) => ({ ...prev, message: "Target face folder selected for Assist." }));
    } catch (error) {
      setStatus((prev) => ({ ...prev, message: String(error) }));
    }
  };

  const saveAssistJson = async () => {
    try {
      if (!sourceVideoPath.trim()) {
        setStatus((prev) => ({ ...prev, message: "Source video path is empty." }));
        return;
      }
      if (!assistJsonPath.trim()) {
        setStatus((prev) => ({ ...prev, message: "Assist JSON path is empty." }));
        return;
      }
      if (anchors.length < 2) {
        setStatus((prev) => ({ ...prev, message: "Add at least 2 anchors before saving Assist JSON." }));
        return;
      }
      const result = await invoke("save_manual_assist_json", {
        path: assistJsonPath.trim(),
        sourceVideo: sourceVideoPath.trim(),
        targetFacePath: targetFacePath.trim() || null,
        assistTrackingEngine,
        anchors,
      });
      setStatus((prev) => ({ ...prev, message: `Assist JSON saved. anchors=${result.anchors?.length || anchors.length}` }));
    } catch (error) {
      setStatus((prev) => ({ ...prev, message: String(error) }));
    }
  };

  const loadAssistJson = async () => {
    try {
      const picked = await invoke("pick_json_file_with_default", {
        startDir: directoryOf(assistJsonPath) || appConfig.assistJsonDir || directoryOf(sourceVideoPath) || null,
      });
      if (!picked) {
        setStatus((prev) => ({ ...prev, message: "Assist JSON selection cancelled." }));
        return;
      }
      const result = await invoke("load_manual_assist_json", { path: picked });
      setAssistJsonPath(picked);
      setAnchors(Array.isArray(result.anchors) ? result.anchors : []);
      if (typeof result.targetFacePath === "string" && result.targetFacePath.trim()) setTargetFacePath(result.targetFacePath);
      if (typeof result.assistTrackingEngine === "string" && result.assistTrackingEngine.trim()) setAssistTrackingEngine(result.assistTrackingEngine);
      if (typeof result.sourceVideo === "string" && result.sourceVideo.trim()) {
        setSourceVideoPath(result.sourceVideo);
        const info = await invoke("open_video", { path: result.sourceVideo });
        setVideoInfo(info);
        await attachPreviewForSource(result.sourceVideo);
      }
      setStatus((prev) => ({ ...prev, message: `Assist JSON loaded. anchors=${result.anchors?.length || 0}` }));
    } catch (error) {
      setStatus((prev) => ({ ...prev, message: String(error) }));
    }
  };

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video?.src) {
      setStatus((prev) => ({ ...prev, message: "No preview video src is attached yet." }));
      return;
    }
    try {
      if (video.paused) {
        setStatus((prev) => ({ ...prev, message: "Calling video.play()..." }));
        const promise = video.play();
        if (promise?.then) await promise;
        pushEvent("playCallResolved");
      } else {
        video.pause();
        pushEvent("pauseCallResolved");
      }
    } catch (error) {
      pushEvent("playCallRejected", { message: String(error) });
      setStatus((prev) => ({ ...prev, message: `Video play failed: ${error}` }));
    }
  };

  const clearSelection = () => {
    setDragRect(null);
    setDragStart(null);
  };

  const clearAnchors = () => setAnchors([]);

  const sortAnchors = () => {
    setAnchors((prev) => [...prev].sort((a, b) => a.timeSec - b.timeSec));
    setStatus((prev) => ({ ...prev, message: "Anchors sorted by time." }));
  };

  const sendToReframe = async () => {
    if (!assistJsonPath.trim()) {
      setStatus((prev) => ({ ...prev, message: "Assist JSON path is empty." }));
      return;
    }
    if (anchors.length >= 2) await saveAssistJson();
    onSendToReframe?.(assistJsonPath.trim());
  };

  const getCanvasPoint = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return {
      x: Math.min(Math.max(x, 0), canvas.width),
      y: Math.min(Math.max(y, 0), canvas.height),
    };
  };

  const finishDrag = () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!dragRect || !canvas || !video || !videoInfo) {
      setDragRect(null);
      setDragStart(null);
      return;
    }
    const norm = normalizeRect(dragRect);
    if (norm.w < 12 || norm.h < 12) {
      setStatus((prev) => ({ ...prev, message: "Selection too small. Draw a larger face rectangle." }));
      setDragRect(null);
      setDragStart(null);
      return;
    }
    const anchor = {
      timeSec: Number((video.currentTime || 0).toFixed(3)),
      centerXRatio: (norm.x + norm.w * 0.5) / canvas.width,
      rectXRatio: norm.x / canvas.width,
      rectYRatio: norm.y / canvas.height,
      rectWRatio: norm.w / canvas.width,
      rectHRatio: norm.h / canvas.height,
    };
    setAnchors((prev) => [...prev, anchor].sort((a, b) => a.timeSec - b.timeSec));
    setStatus((prev) => ({
      ...prev,
      message: `Anchor saved at ${secondsLabel(anchor.timeSec)} | center ${(anchor.centerXRatio * 100).toFixed(1)}%`,
    }));
    setDragRect(null);
    setDragStart(null);
  };

  const onPointerDown = (event) => {
    if (!videoInfo) return;
    const video = videoRef.current;
    video?.pause();
    const pt = getCanvasPoint(event);
    setDragStart(pt);
    setDragRect({ x: pt.x, y: pt.y, w: 0, h: 0 });
  };

  const onPointerMove = (event) => {
    if (!dragStart) return;
    const pt = getCanvasPoint(event);
    setDragRect({ x: dragStart.x, y: dragStart.y, w: pt.x - dragStart.x, h: pt.y - dragStart.y });
  };

  const diagnosticsText = useMemo(() => JSON.stringify(status, null, 2), [status]);

  return (
    <div className={`grid min-h-full gap-4 ${embedded ? "grid-cols-1" : "grid-cols-[minmax(0,1.7fr)_340px]"}`}>
      <section className="rounded-[28px] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur-xl">
        {embedded ? (
          <>
            <h2 className="text-[28px] font-semibold tracking-tight text-ink">Step 1. Assist Anchors</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Open the source, place manual anchors only where tracking drifts, then keep the saved Assist JSON for the export section below.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-[34px] font-semibold tracking-tight text-ink">Pre Reframe Workspace</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Preview the source, place manual face anchors only where tracking drifts, then save Assist JSON for the Reframe workspace.
            </p>
          </>
        )}

        <div className="mt-4 overflow-hidden rounded-[26px] border border-line bg-[#09101d] shadow-[0_18px_36px_rgba(15,23,42,0.18)]">
          <video
            ref={videoRef}
            src={previewUrl}
            controls
            playsInline
            className="block h-[clamp(460px,62vh,820px)] w-full bg-[#09101d] object-contain"
            onLoadedMetadata={() => {
              redrawOverlay();
              pushEvent("loadedmetadata");
            }}
            onTimeUpdate={(event) => {
              setCurrentTime(event.currentTarget.currentTime || 0);
              redrawOverlay();
            }}
            onPlay={() => {
              pushEvent("play");
              redrawOverlay();
            }}
            onPause={() => {
              pushEvent("pause");
              redrawOverlay();
            }}
            onCanPlay={() => pushEvent("canplay")}
            onError={() => {
              const error = videoRef.current?.error;
              pushEvent("error", { code: error?.code || null, message: error?.message || "" });
            }}
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full"
            onMouseDown={onPointerDown}
            onMouseMove={onPointerMove}
            onMouseUp={finishDrag}
            onMouseLeave={() => {
              if (dragStart) finishDrag();
            }}
            style={{ pointerEvents: videoInfo && videoRef.current?.paused ? "auto" : "none", cursor: videoInfo ? "crosshair" : "default" }}
          />
        </div>

        <div className="mt-3 flex items-center justify-between gap-4 text-sm text-muted">
          <div>{metaText}</div>
          <div>Pause to place anchors. Keep anchors sparse and intentional.</div>
        </div>

        <div className="mt-4 grid gap-3 rounded-[24px] border border-line bg-[#f8fafc]/80 p-4">
          <div className="grid gap-2">
            <div className="text-sm font-semibold text-[#344054]">Source video path</div>
            <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-3">
              <input value={sourceVideoPath} readOnly className="app-input app-input-readonly" />
              <ActionButton icon={FolderOpen} onClick={openSourceVideo} className="app-btn-primary">
                Select Source Video
              </ActionButton>
            </div>
          </div>

          <div className="grid gap-2">
            <div className="text-sm font-semibold text-[#344054]">Target face folder path</div>
            <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-3">
              <input value={targetFacePath} readOnly className="app-input app-input-readonly" />
              <ActionButton icon={FolderOpen} onClick={pickTargetFaceFolder} className="app-btn-secondary">
                Select Target Face Folder
              </ActionButton>
            </div>
          </div>

          <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] gap-4">
            <Field label="Assist tracking engine">
              <select
                value={assistTrackingEngine}
                onChange={(event) => setAssistTrackingEngine(event.target.value)}
                className="app-select"
              >
                {ENGINE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Assist JSON path">
              <input
                value={assistJsonPath}
                onChange={(event) => setAssistJsonPath(event.target.value)}
                placeholder="Configured assist-json directory or source folder"
                className="app-input"
              />
            </Field>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_320px] items-end gap-4">
            <div className="grid gap-2">
              <div className="flex items-center justify-between text-sm font-semibold text-[#344054]">
                <span>Assist stability</span>
                <span className="text-[#0f172a]">{stability.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={stability}
                onChange={(event) => setStability(Number(event.target.value))}
              />
            </div>
            <Field label="Playback speed">
              <select
                value={playbackRate}
                onChange={(event) => setPlaybackRate(event.target.value)}
                className="app-select"
              >
                {PLAYBACK_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}x
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[repeat(4,minmax(0,1fr))] gap-3">
          <ActionButton icon={Play} onClick={togglePlayback} className="app-btn-ghost">
            Play / Pause
          </ActionButton>
          <ActionButton onClick={clearSelection} className="app-btn-ghost">
            Clear Selection
          </ActionButton>
          <ActionButton icon={Save} onClick={saveAssistJson} className="app-btn-secondary">
            Save Assist JSON
          </ActionButton>
          <ActionButton icon={Upload} onClick={loadAssistJson} className="app-btn-secondary">
            Load Assist JSON
          </ActionButton>
        </div>

        <div className="mt-3 rounded-[20px] border border-line bg-[#fbfcfe] px-4 py-3 text-sm leading-6 text-muted">
          Pause the video, drag a face rectangle, and the anchor is saved automatically at the current time. Repeat only where tracking would drift.
        </div>

        {!embedded ? (
          <div className="mt-3">
            <ActionButton icon={Wand2} onClick={sendToReframe} className="app-btn app-btn-primary w-full">
              Send Assist JSON To Reframe
            </ActionButton>
          </div>
        ) : null}

        <label className="mt-5 flex items-center gap-3 text-sm font-medium text-[#344054]">
          <input type="checkbox" checked={showAllAnchors} onChange={(event) => setShowAllAnchors(event.target.checked)} />
          <span>Show all saved anchors</span>
        </label>
      </section>

      <section className="rounded-[28px] border border-white/70 bg-white/78 p-4 shadow-panel backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-[26px] font-semibold tracking-tight text-ink">Status</h2>
          <div className="text-sm font-medium text-muted">Idle</div>
        </div>
        <div className="mt-4 h-2 rounded-full bg-[#e5e7eb]">
          <div className="h-2 w-0 rounded-full bg-accent" />
        </div>
        <pre className="mt-4 h-[200px] overflow-auto rounded-[20px] border border-line bg-[#f8fafc] p-4 text-xs leading-6 text-[#344054]">
          {diagnosticsText}
        </pre>

        <div className="mt-6 flex items-center justify-between">
          <h2 className="text-[26px] font-semibold tracking-tight text-ink">Anchors</h2>
          <div className="text-sm text-muted">{anchors.length} saved</div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <ActionButton onClick={sortAnchors} className="bg-[#f7f9fc] text-ink shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
            Sort Anchors
          </ActionButton>
          <ActionButton onClick={clearAnchors} className="bg-[#f7f9fc] text-ink shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
            Clear Anchors
          </ActionButton>
        </div>

        <div className="mt-4 grid max-h-[200px] gap-3 overflow-auto pr-1">
          {anchors.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-line bg-[#f8fafc] px-4 py-5 text-sm text-muted">
              No anchors yet.
            </div>
          ) : (
            anchors.map((anchor, index) => (
              <div key={`${anchor.timeSec}-${index}`} className="flex items-center justify-between gap-3 rounded-[18px] border border-line bg-[#f8fafc] px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">
                    #{index + 1} {secondsLabel(anchor.timeSec)}
                  </div>
                  <div className="mt-1 text-xs text-muted">x {(anchor.centerXRatio * 100).toFixed(1)}%</div>
                </div>
                <div className="flex gap-2">
                  <ActionButton
                    onClick={() => {
                      const video = videoRef.current;
                      if (!video) return;
                      video.currentTime = anchor.timeSec;
                      video.pause();
                      setCurrentTime(anchor.timeSec);
                    }}
                    className="min-h-[36px] bg-white px-3 py-2 text-ink shadow-none"
                  >
                    Jump
                  </ActionButton>
                  <ActionButton
                    onClick={() => setAnchors((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                    className="min-h-[36px] bg-white px-3 py-2 text-ink shadow-none"
                  >
                    Delete
                  </ActionButton>
                </div>
              </div>
            ))
          )}
        </div>

        <h2 className="mt-6 text-[26px] font-semibold tracking-tight text-ink">Assist JSON</h2>
        <pre className="mt-4 max-h-[200px] overflow-auto rounded-[20px] border border-line bg-[#f8fafc] p-4 text-xs leading-6 text-[#344054]">
          {anchorJson}
        </pre>
      </section>
    </div>
  );
}
