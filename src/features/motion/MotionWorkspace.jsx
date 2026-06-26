import { useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, FolderOpen, Play, Save, Sparkles, Wand2 } from "lucide-react";

import { invoke } from "../../lib/tauri";

const LEGACY_SETTINGS_KEY = "naVShorts.effects.v1";
const SETTINGS_KEY = "naVShorts.motion.v1";
const CINE_SETTINGS_KEY = "naVShorts.cineMotion.v1";
const DEFAULT_MOTION_MODE = "cineMotion";
const CINE_DEFAULTS = {
  zoomSoftStrength: 1.05,
  zoomStrongStrength: 1.08,
  zoomAttackSec: 0.14,
  zoomReleaseSec: 1.0,
  panOffset: 0.05,
  panAttackSec: 0.14,
  panReleaseSec: 1.1,
  cursorFocusStrength: 1.06,
  cursorFocusAttackSec: 0.15,
  cursorFocusReleaseSec: 1.05,
  easing: "easeOutCubic",
};

const QUICK_PRESETS = [
  { value: "shorts1080x1920", label: "YouTube Shorts (1080x1920)" },
  { value: "reels1080x1920", label: "Instagram Reels (1080x1920)" },
  { value: "vertical4k2160x3840", label: "Vertical 4K (2160x3840)" },
];

const ENCODER_OPTIONS = [
  { value: "auto", label: "Auto (recommended)" },
  { value: "cpu", label: "CPU (libx264)" },
  { value: "nvidia", label: "NVIDIA (NVENC)" },
  { value: "intel", label: "Intel (QSV)" },
  { value: "amd", label: "AMD (AMF)" },
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function timestampYYMMDDhhmmss(d = new Date()) {
  const yy = pad2(d.getFullYear() % 100);
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${yy}${mm}${dd}${hh}${mi}${ss}`;
}

function buildDefaultOutputPath(inputFullPath) {
  const normalized = inputFullPath.replace(/\//g, "\\");
  const lastSlash = normalized.lastIndexOf("\\");
  const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : "";
  const file = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const dot = file.lastIndexOf(".");
  const base = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : ".mp4";
  return `${dir}${base}_exported_${timestampYYMMDDhhmmss()}${ext}`;
}

function buildLabeledOutputPath(inputFullPath, label) {
  const normalized = inputFullPath.replace(/\//g, "\\");
  const lastSlash = normalized.lastIndexOf("\\");
  const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : "";
  const file = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const dot = file.lastIndexOf(".");
  const base = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : ".mp4";
  return `${dir}${base}_${label}_${timestampYYMMDDhhmmss()}${ext}`;
}

function buildCineOutputPath(inputFullPath) {
  return buildLabeledOutputPath(inputFullPath, "cinemotion");
}

function buildPreviewOutputPath(currentOutputPath, inputFullPath) {
  const source = (currentOutputPath || "").trim() || buildDefaultOutputPath(inputFullPath || "");
  const normalized = source.replace(/\//g, "\\");
  const dot = normalized.lastIndexOf(".");
  if (dot > 0) return `${normalized.slice(0, dot)}_preview${normalized.slice(dot)}`;
  return `${normalized}_preview.mp4`;
}

function secondsLabel(sec) {
  const total = Math.max(0, Number(sec) || 0);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total - Math.floor(total)) * 100);
  return `${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
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

export default function MotionWorkspace({ reframedInput }) {
  const cineVideoRef = useRef(null);
  const [motionMode, setMotionMode] = useState(DEFAULT_MOTION_MODE);
  const [videoPath, setVideoPath] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [projectInfo, setProjectInfo] = useState("No video loaded.");
  const [statusText, setStatusText] = useState("Idle.");
  const [progress, setProgress] = useState(0);
  const [etaInfo, setEtaInfo] = useState("Idle");

  const [zoomMode, setZoomMode] = useState("zoomIn");
  const [zoomStrength, setZoomStrength] = useState(0.18);
  const [bounceStrength, setBounceStrength] = useState(0.16);
  const [beatSensitivity, setBeatSensitivity] = useState(0.55);
  const [motionBlurStrength, setMotionBlurStrength] = useState(0);
  const [preset, setPreset] = useState("shorts1080x1920");
  const [encoder, setEncoder] = useState("auto");

  const [cineVideoPath, setCineVideoPath] = useState("");
  const [cineOutputPath, setCineOutputPath] = useState("");
  const [cinePreset, setCinePreset] = useState("shorts1080x1920");
  const [cineEncoder, setCineEncoder] = useState("auto");
  const [cinePlaybackRate, setCinePlaybackRate] = useState("1");
  const [cineEvents, setCineEvents] = useState([]);
  const [cineMeta, setCineMeta] = useState("No video loaded.");
  const [cinePreviewPath, setCinePreviewPath] = useState("");
  const [cineBlobUrl, setCineBlobUrl] = useState("");
  const [cineHoverPoint, setCineHoverPoint] = useState({ x: 0.5, y: 0.5 });
  const [cineVideoInfo, setCineVideoInfo] = useState(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY) || localStorage.getItem(LEGACY_SETTINGS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.motionMode === "string") setMotionMode(s.motionMode);
        if (typeof s.zoomMode === "string") setZoomMode(s.zoomMode);
        if (typeof s.zoomStrength === "number") setZoomStrength(s.zoomStrength);
        if (typeof s.bounceStrength === "number") setBounceStrength(s.bounceStrength);
        if (typeof s.beatSensitivity === "number") setBeatSensitivity(s.beatSensitivity);
        if (typeof s.motionBlurStrength === "number") setMotionBlurStrength(s.motionBlurStrength);
        if (typeof s.preset === "string") setPreset(s.preset);
        if (typeof s.encoder === "string") setEncoder(s.encoder);
      }
      const cineRaw = localStorage.getItem(CINE_SETTINGS_KEY);
      if (cineRaw) {
        const s = JSON.parse(cineRaw);
        if (typeof s.videoPath === "string") setCineVideoPath(s.videoPath);
        if (typeof s.outputPath === "string") setCineOutputPath(s.outputPath);
        if (typeof s.preset === "string") setCinePreset(s.preset);
        if (typeof s.encoder === "string") setCineEncoder(s.encoder);
        if (typeof s.playbackRate === "string") setCinePlaybackRate(s.playbackRate);
        if (Array.isArray(s.events)) setCineEvents(s.events);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        motionMode,
        zoomMode,
        zoomStrength,
        bounceStrength,
        beatSensitivity,
        motionBlurStrength,
        preset,
        encoder,
      }),
    );
  }, [motionMode, zoomMode, zoomStrength, bounceStrength, beatSensitivity, motionBlurStrength, preset, encoder]);

  useEffect(() => {
    localStorage.setItem(
      CINE_SETTINGS_KEY,
      JSON.stringify({
        videoPath: cineVideoPath,
        outputPath: cineOutputPath,
        preset: cinePreset,
        encoder: cineEncoder,
        playbackRate: cinePlaybackRate,
        events: cineEvents,
      }),
    );
  }, [cineVideoPath, cineOutputPath, cinePreset, cineEncoder, cinePlaybackRate, cineEvents]);

  useEffect(() => {
    invoke("get_project")
      .then((project) => setProjectInfo(JSON.stringify(project, null, 2)))
      .catch(() => {});
    invoke("get_encoder_options")
      .then((available) => {
        if (!available.includes(encoder) && !["auto", "cpu"].includes(encoder)) setEncoder("auto");
        if (!available.includes(cineEncoder) && !["auto", "cpu"].includes(cineEncoder)) setCineEncoder("auto");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!reframedInput) return;
    let alive = true;

    const hydrateFromReframe = async () => {
      try {
        setStatusText("Loading reframed video from Reframe workspace...");
        setVideoPath(reframedInput);
        setOutputPath(buildDefaultOutputPath(reframedInput));
        setCineVideoPath(reframedInput);
        setCineOutputPath((current) => current || buildCineOutputPath(reframedInput));

        if (motionMode === "cineMotion") {
          await loadCineVideo(reframedInput, { silent: true });
        } else {
          const info = await invoke("open_video", { path: reframedInput });
          if (!alive) return;
          setProjectInfo(JSON.stringify(info, null, 2));
        }

        const project = await invoke("get_project");
        if (!alive) return;
        setProjectInfo(JSON.stringify(project, null, 2));
        setStatusText("Reframed video loaded from Reframe workspace and ready in Motion.");
      } catch (error) {
        if (!alive) return;
        setStatusText(String(error));
      }
    };

    hydrateFromReframe();
    return () => {
      alive = false;
    };
  }, [motionMode, reframedInput]);

  useEffect(() => {
    const video = cineVideoRef.current;
    if (video) video.playbackRate = Number(cinePlaybackRate || 1);
  }, [cinePlaybackRate, cineBlobUrl]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (motionMode !== "cineMotion") return;
      const target = event.target;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

      if (event.ctrlKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undoLastCineEvent();
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        toggleCinePlayback();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepCine(-5);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        stepCine(5);
        return;
      }
      if (!cineVideoRef.current?.src) return;

      const record = (type, patch = {}) => {
        const current = cineVideoRef.current;
        const nextEvent = {
          timeSec: Number.isFinite(current.currentTime) ? Number(current.currentTime.toFixed(3)) : 0,
          type,
          strength: patch.strength ?? 1.0,
          attackSec: patch.attackSec ?? 0.15,
          releaseSec: patch.releaseSec ?? 1.0,
          easing: patch.easing ?? CINE_DEFAULTS.easing,
          offsetX: patch.offsetX ?? 0,
          offsetY: patch.offsetY ?? 0,
          focusXRatio: patch.focusXRatio ?? null,
          focusYRatio: patch.focusYRatio ?? null,
        };
        setCineEvents((prev) => [...prev, nextEvent].sort((a, b) => Number(a.timeSec || 0) - Number(b.timeSec || 0)));
        setStatusText(`Recorded ${nextEvent.type} event at ${secondsLabel(nextEvent.timeSec)}.`);
      };

      switch (event.key.toLowerCase()) {
        case "z":
          event.preventDefault();
          record("zoom", { strength: CINE_DEFAULTS.zoomSoftStrength, attackSec: CINE_DEFAULTS.zoomAttackSec, releaseSec: CINE_DEFAULTS.zoomReleaseSec });
          break;
        case "x":
          event.preventDefault();
          record("zoom", { strength: CINE_DEFAULTS.zoomStrongStrength, attackSec: CINE_DEFAULTS.zoomAttackSec, releaseSec: CINE_DEFAULTS.zoomReleaseSec });
          break;
        case "v":
          event.preventDefault();
          record("pan", { offsetX: -CINE_DEFAULTS.panOffset, attackSec: CINE_DEFAULTS.panAttackSec, releaseSec: CINE_DEFAULTS.panReleaseSec });
          break;
        case "b":
          event.preventDefault();
          record("pan", { offsetX: CINE_DEFAULTS.panOffset, attackSec: CINE_DEFAULTS.panAttackSec, releaseSec: CINE_DEFAULTS.panReleaseSec });
          break;
        case "n":
          event.preventDefault();
          record("pan", { offsetY: -CINE_DEFAULTS.panOffset, attackSec: CINE_DEFAULTS.panAttackSec, releaseSec: CINE_DEFAULTS.panReleaseSec });
          break;
        case "m":
          event.preventDefault();
          record("pan", { offsetY: CINE_DEFAULTS.panOffset, attackSec: CINE_DEFAULTS.panAttackSec, releaseSec: CINE_DEFAULTS.panReleaseSec });
          break;
        case "c":
          event.preventDefault();
          record("cursorFocus", {
            strength: CINE_DEFAULTS.cursorFocusStrength,
            attackSec: CINE_DEFAULTS.cursorFocusAttackSec,
            releaseSec: CINE_DEFAULTS.cursorFocusReleaseSec,
            focusXRatio: cineHoverPoint.x,
            focusYRatio: cineHoverPoint.y,
          });
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [cineHoverPoint, motionMode]);

  useEffect(() => () => {
    if (cineBlobUrl.startsWith("blob:")) URL.revokeObjectURL(cineBlobUrl);
  }, [cineBlobUrl]);

  const buildEffectsPayload = () => ({
    zoomMode,
    zoomStrength: Number(zoomStrength),
    bounceStrength: Number(bounceStrength),
    beatSensitivity: Number(beatSensitivity),
    motionBlurStrength: Number(motionBlurStrength),
  });

  const applyEffects = async () => {
    const project = await invoke("set_effects", { config: buildEffectsPayload() });
    setProjectInfo(JSON.stringify(project, null, 2));
    return project;
  };

  const analyzeBeats = async () => {
    const path = videoPath.trim();
    if (!path) throw new Error("Load a video before analyzing beats.");
    const beats = await invoke("analyze_beats", { path, sensitivity: Number(beatSensitivity) });
    const project = await invoke("get_project");
    setProjectInfo(JSON.stringify(project, null, 2));
    return beats;
  };

  const prepareEffectsForRender = async (kindLabel) => {
    const path = videoPath.trim();
    if (!path) throw new Error("Load a video before rendering.");
    setProgress(0);
    setEtaInfo(`Auto analyze/apply running for ${kindLabel}...`);
    setStatusText(`Auto analyze/apply running for ${kindLabel}: analyzing beats...`);
    const beats = await analyzeBeats();
    setStatusText(`Auto analyze/apply running for ${kindLabel}: applying effects after ${beats.points.length} beat points...`);
    await applyEffects();
    setStatusText(`Auto analyze/apply complete for ${kindLabel}. Beat points: ${beats.points.length}`);
  };

  const trackRenderJob = async (jobId, completedLabel) => {
    const startedAt = Date.now();
    setProgress(0);
    setEtaInfo("Starting...");
    setStatusText(JSON.stringify({ jobId, state: "queued" }, null, 2));
    return new Promise((resolve) => {
      const timer = setInterval(async () => {
        try {
          const status = await invoke("get_render_status", { jobId });
          setStatusText(JSON.stringify(status, null, 2));
          const p = Number(status.progress || 0);
          if (p > 0 && p < 1) {
            const elapsedSec = (Date.now() - startedAt) / 1000;
            const totalSec = elapsedSec / p;
            const remainSec = Math.max(0, totalSec - elapsedSec);
            setProgress(p);
            setEtaInfo(`Progress ${(p * 100).toFixed(1)}% | ETA ${Math.ceil(remainSec)}s`);
          } else if (status.state === "completed") {
            setProgress(1);
            setEtaInfo(completedLabel);
          } else if (["failed", "cancelled"].includes(status.state)) {
            setProgress(p);
            setEtaInfo(`Stopped (${status.state})`);
          }
          if (["completed", "failed", "cancelled"].includes(status.state)) {
            clearInterval(timer);
            resolve(status);
          }
        } catch (error) {
          clearInterval(timer);
          setStatusText(String(error));
          setProgress(0);
          setEtaInfo("Error");
          resolve(null);
        }
      }, 800);
    });
  };

  const openQuickVideo = async () => {
    try {
      const picked = await invoke("pick_video_file");
      if (!picked) {
        setStatusText("Video selection cancelled.");
        return;
      }
      const info = await invoke("open_video", { path: picked });
      setVideoPath(picked);
      setOutputPath(buildDefaultOutputPath(picked));
      setCineVideoPath(picked);
      setCineOutputPath((current) => current || buildCineOutputPath(picked));
      setStatusText("Video loaded.");
      setProjectInfo(JSON.stringify(info, null, 2));
      const project = await invoke("get_project");
      setProjectInfo(JSON.stringify(project, null, 2));
    } catch (error) {
      setStatusText(String(error));
    }
  };

  const startQuickRender = async (preview) => {
    try {
      const kind = preview ? "preview" : "export";
      await prepareEffectsForRender(kind);
      const finalOutputPath = preview ? buildPreviewOutputPath(outputPath.trim(), videoPath.trim()) : outputPath.trim();
      const jobId = await invoke("render", {
        request: {
          outputPath: finalOutputPath,
          preset,
          preview,
          encoder,
        },
      });
      await trackRenderJob(jobId, preview ? "Preview completed" : "Completed");
    } catch (error) {
      setStatusText(String(error));
      setProgress(0);
      setEtaInfo("Error");
    }
  };

  const loadPreviewBlobUrl = async (previewPath) => {
    const payload = await invoke("read_preview_video_base64", { path: previewPath });
    const binary = atob(payload.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: "video/mp4" });
    return URL.createObjectURL(blob);
  };

  const loadCineVideo = async (path, { silent = false } = {}) => {
    if (!path) return;
    const info = await invoke("open_video", { path });
    setCineVideoInfo(info);
    setCineVideoPath(path);
    setCineOutputPath((current) => current || buildCineOutputPath(path));
    const previewPath = await invoke("create_preview_video_with_audio", { path });
    setCinePreviewPath(previewPath);
    if (cineBlobUrl.startsWith("blob:")) URL.revokeObjectURL(cineBlobUrl);
    const blobUrl = await loadPreviewBlobUrl(previewPath);
    setCineBlobUrl(blobUrl);
    setCineMeta(`Video ${info.width}x${info.height} | ${info.fps.toFixed(2)} fps | duration ${info.duration_sec.toFixed(2)} sec | events ${cineEvents.length}`);
    if (!silent) setStatusText("Source video loaded for Cine Motion.");
  };

  const toggleCinePlayback = async () => {
    const video = cineVideoRef.current;
    if (!video?.src) {
      setStatusText("Load a video before playing Cine Motion preview.");
      return;
    }
    if (video.paused) {
      await video.play().catch((e) => {
        throw new Error(String(e));
      });
    } else {
      video.pause();
    }
  };

  const stepCine = (seconds) => {
    const video = cineVideoRef.current;
    if (!video?.src || !Number.isFinite(seconds)) return;
    const duration = Number.isFinite(video.duration) ? video.duration : Number(cineVideoInfo?.duration_sec || 0);
    const maxTime = Math.max(0, duration - 0.001);
    video.currentTime = Math.min(Math.max((video.currentTime || 0) + seconds, 0), maxTime);
  };

  const undoLastCineEvent = () => {
    setCineEvents((prev) => {
      if (!prev.length) {
        setStatusText("No Cine Motion event to undo.");
        return prev;
      }
      const next = prev.slice(0, -1);
      setStatusText(`Removed last Cine Motion event (${prev[prev.length - 1]?.type || "event"}).`);
      return next;
    });
  };

  const startCineRender = async (preview) => {
    try {
      if (!cineVideoPath.trim()) throw new Error("Load a video before rendering Cine Motion.");
      if (!cineEvents.length) throw new Error("Add at least one Cine Motion event before rendering.");
      const output = cineOutputPath.trim() || buildCineOutputPath(cineVideoPath.trim());
      if (!cineOutputPath.trim()) setCineOutputPath(output);
      const finalOutputPath = preview ? buildPreviewOutputPath(output, cineVideoPath.trim()) : output;
      const jobId = await invoke("render_cine_motion", {
        request: {
          inputPath: cineVideoPath.trim(),
          outputPath: finalOutputPath,
          preset: cinePreset,
          preview,
          encoder: cineEncoder,
          events: cineEvents,
        },
      });
      await trackRenderJob(jobId, preview ? "Cine preview completed" : "Cine Motion completed");
    } catch (error) {
      setStatusText(String(error));
      setProgress(0);
      setEtaInfo("Error");
    }
  };

  const cineJson = useMemo(() => JSON.stringify(cineEvents, null, 2), [cineEvents]);
  const canRenderCineMotion = cineEvents.length > 0;

  return (
    <div className="grid min-h-full grid-cols-[minmax(0,1.6fr)_340px] gap-4">
      <section className="rounded-[28px] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur-xl">
        <h1 className="text-[34px] font-semibold tracking-tight text-ink">Motion Workspace</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Choose one motion style. Use Quick Effects for the fast current workflow, or Cine Motion for semi-manual camera direction.
        </p>

        <div className="mt-6 inline-flex rounded-full border border-line bg-white/82 p-1 shadow-panel">
          {[
            { value: "cineMotion", label: "Cine Motion" },
            { value: "quickEffects", label: "Quick Effects" },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setMotionMode(item.value)}
              className={[
                "rounded-full px-4 py-2 text-sm font-semibold transition",
                motionMode === item.value ? "bg-accent text-white shadow-[0_12px_26px_rgba(0,113,227,0.28)]" : "text-[#475467] hover:bg-[#eef2f7]",
              ].join(" ")}
            >
              {item.label}
            </button>
          ))}
        </div>

        {motionMode === "quickEffects" ? (
          <div className="mt-4 grid gap-3 rounded-[24px] border border-line bg-[#f8fafc]/80 p-4">
            <div className="grid gap-2">
              <div className="text-sm font-semibold text-[#344054]">Video file path</div>
              <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-3">
                <input value={videoPath} readOnly className="app-input app-input-readonly" />
                <ActionButton icon={FolderOpen} onClick={openQuickVideo} className="app-btn-primary">
                  Select & Open Video
                </ActionButton>
              </div>
            </div>

            <h2 className="mt-2 text-[26px] font-semibold tracking-tight text-ink">Quick Effects</h2>
            <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-4">
              <Field label="Zoom mode">
                <select value={zoomMode} onChange={(e) => setZoomMode(e.target.value)} className="app-select">
                  <option value="none">None</option>
                  <option value="zoomIn">Zoom In</option>
                  <option value="zoomOut">Zoom Out</option>
                  <option value="zoomInOutBeat">Zoom In & Out (Beat Sync)</option>
                  <option value="zoomInOutLoop">Zoom In & Out (Loop)</option>
                  <option value="zoomSineSmooth">Zoom Sine Smooth (tmix optional)</option>
                </select>
              </Field>
              <Field label="Preset">
                <select value={preset} onChange={(e) => setPreset(e.target.value)} className="app-select">
                  {QUICK_PRESETS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {[
              ["Zoom strength", zoomStrength, setZoomStrength],
              ["Bounce strength", bounceStrength, setBounceStrength],
              ["Beat sensitivity", beatSensitivity, setBeatSensitivity],
              ["Motion blur strength", motionBlurStrength, setMotionBlurStrength],
            ].map(([label, value, setter]) => (
              <div key={label} className="grid grid-cols-[220px_72px_minmax(0,1fr)] items-center gap-3">
                <div className="text-sm font-semibold text-[#344054]">{label}</div>
                <div className="text-right text-sm font-semibold text-[#0f172a]">{Number(value).toFixed(2)}</div>
                <input type="range" min="0" max="1" step="0.01" value={value} onChange={(e) => setter(Number(e.target.value))} />
              </div>
            ))}

            <div className="grid grid-cols-2 gap-3">
              <ActionButton icon={Sparkles} onClick={analyzeBeats} className="app-btn-ghost">
                Analyze Beats
              </ActionButton>
              <ActionButton icon={Save} onClick={applyEffects} className="app-btn-secondary">
                Apply Effects
              </ActionButton>
            </div>

            <h2 className="mt-2 text-[26px] font-semibold tracking-tight text-ink">Render</h2>
            <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-4">
              <Field label="Output path">
                <input value={outputPath} onChange={(e) => setOutputPath(e.target.value)} className="app-input" />
              </Field>
              <Field label="Video encoder">
                <select value={encoder} onChange={(e) => setEncoder(e.target.value)} className="app-select">
                  {ENCODER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <ActionButton icon={Play} onClick={() => startQuickRender(true)} className="app-btn-ghost">
                Render Preview
              </ActionButton>
              <ActionButton icon={Clapperboard} onClick={() => startQuickRender(false)} className="app-btn-primary">
                Export Final
              </ActionButton>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4 overflow-hidden rounded-[26px] border border-line bg-[#09101d] shadow-[0_18px_36px_rgba(15,23,42,0.18)]">
              <video
                ref={cineVideoRef}
                src={cineBlobUrl}
                controls
                playsInline
                className="block h-[clamp(420px,56vh,700px)] w-full bg-[#09101d] object-contain"
                onLoadedMetadata={(event) => {
                  setCineMeta(`Video ${event.currentTarget.videoWidth || cineVideoInfo?.width || 0}x${event.currentTarget.videoHeight || cineVideoInfo?.height || 0} | ${cineVideoInfo?.fps?.toFixed?.(2) || "0.00"} fps | duration ${Number(event.currentTarget.duration || cineVideoInfo?.duration_sec || 0).toFixed(2)} sec | events ${cineEvents.length}`);
                }}
                onMouseMove={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  if (!rect.width || !rect.height) return;
                  setCineHoverPoint({
                    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
                    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
                  });
                }}
              />
            </div>

            <div className="mt-3 flex items-center justify-between gap-4 text-sm text-muted">
              <div>{cineMeta}</div>
              <div>Record camera accents directly on the preview.</div>
            </div>

            <div className="mt-4 grid gap-3 rounded-[24px] border border-line bg-[#f8fafc]/80 p-4">
              <h2 className="text-[26px] font-semibold tracking-tight text-ink">Cine Motion</h2>
              <p className="text-sm leading-7 text-muted">
                Semi-manual camera direction for natural zoom and pan accents. Use keyboard shortcuts on the preview to record events.
              </p>
              <div className="grid gap-2">
                <div className="text-sm font-semibold text-[#344054]">Video file path</div>
                <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-3">
                  <input value={cineVideoPath} readOnly className="app-input app-input-readonly" />
                  <ActionButton icon={FolderOpen} onClick={async () => {
                    try {
                      const picked = await invoke("pick_video_file");
                      if (!picked) {
                        setStatusText("Video selection cancelled.");
                        return;
                      }
                      await loadCineVideo(picked);
                    } catch (error) {
                      setStatusText(String(error));
                    }
                  }} className="app-btn-primary">
                    Select & Open Video
                  </ActionButton>
                </div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-4">
                <Field label="Playback speed">
                  <select value={cinePlaybackRate} onChange={(e) => setCinePlaybackRate(e.target.value)} className="app-select">
                    <option value="0.5">0.5x</option>
                    <option value="1">1.0x</option>
                    <option value="1.5">1.5x</option>
                    <option value="2">2.0x</option>
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3 self-end">
                  <ActionButton icon={Play} onClick={toggleCinePlayback} className="app-btn-ghost">
                    Play / Pause
                  </ActionButton>
                  <ActionButton onClick={undoLastCineEvent} className="app-btn-secondary">
                    Undo Last Event
                  </ActionButton>
                </div>
              </div>
              <div className="rounded-[20px] border border-line bg-[#fbfcfe] px-4 py-3 text-sm leading-6 text-muted">
                Shortcuts: Space play/pause, left/right move 5 sec, Z soft zoom, X strong zoom, C cursor focus, V/B pan left/right, N/M pan up/down, Ctrl+Z undo.
              </div>
              {!canRenderCineMotion ? (
                <div className="rounded-[20px] border border-[#fecdca] bg-[#fff7f5] px-4 py-3 text-sm leading-6 text-[#b42318]">
                  Add at least one Cine Motion event before preview or export. Record events on the video first.
                </div>
              ) : null}
              <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-4">
                <Field label="Preset">
                  <select value={cinePreset} onChange={(e) => setCinePreset(e.target.value)} className="app-select">
                    {QUICK_PRESETS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Video encoder">
                  <select value={cineEncoder} onChange={(e) => setCineEncoder(e.target.value)} className="app-select">
                    {ENCODER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid gap-3">
                <Field label="Output path">
                  <input value={cineOutputPath} onChange={(e) => setCineOutputPath(e.target.value)} className="app-input" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <ActionButton icon={Play} onClick={() => startCineRender(true)} disabled={!canRenderCineMotion} className="app-btn-ghost disabled:cursor-not-allowed disabled:opacity-50">
                  Render Cine Preview
                </ActionButton>
                <ActionButton icon={Clapperboard} onClick={() => startCineRender(false)} disabled={!canRenderCineMotion} className="app-btn-primary disabled:cursor-not-allowed disabled:opacity-50">
                  Export Cine Motion
                </ActionButton>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="rounded-[28px] border border-white/70 bg-white/78 p-4 shadow-panel backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-[26px] font-semibold tracking-tight text-ink">Status</h2>
          <div className="text-sm font-medium text-muted">{etaInfo}</div>
        </div>
        <div className="mt-4 h-2 rounded-full bg-[#e5e7eb]">
          <div className="h-2 rounded-full bg-accent transition-all" style={{ width: `${Math.max(0, Math.min(progress, 1)) * 100}%` }} />
        </div>
        <pre className="mt-4 h-[190px] overflow-auto rounded-[20px] border border-line bg-[#f8fafc] p-4 text-xs leading-6 text-[#344054]">
          {statusText}
        </pre>

        {motionMode === "cineMotion" ? (
          <>
            <div className="mt-6 flex items-center justify-between">
              <h2 className="text-[26px] font-semibold tracking-tight text-ink">Cine Events</h2>
              <div className="text-sm text-muted">{cineEvents.length} saved</div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <ActionButton onClick={() => setCineEvents((prev) => [...prev].sort((a, b) => Number(a.timeSec || 0) - Number(b.timeSec || 0)))} className="bg-[#f7f9fc] text-ink shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
                Sort Events
              </ActionButton>
              <ActionButton onClick={() => setCineEvents([])} className="bg-[#f7f9fc] text-ink shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
                Clear Events
              </ActionButton>
            </div>
            <div className="mt-4 grid max-h-[190px] gap-3 overflow-auto pr-1">
              {cineEvents.length === 0 ? (
                <div className="rounded-[18px] border border-dashed border-line bg-[#f8fafc] px-4 py-5 text-sm text-muted">
                  No Cine Motion events yet.
                </div>
              ) : (
                cineEvents.map((event, index) => (
                  <div key={`${event.timeSec}-${index}`} className="flex items-start justify-between gap-3 rounded-[18px] border border-line bg-[#f8fafc] px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ink">
                        #{index + 1} {secondsLabel(event.timeSec)} | {event.type}
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        strength {Number(event.strength || 1).toFixed(2)} / attack {Number(event.attackSec || 0).toFixed(2)} / release {Number(event.releaseSec || 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <ActionButton
                        onClick={() => {
                          const video = cineVideoRef.current;
                          if (!video) return;
                          video.currentTime = Number(event.timeSec || 0);
                          video.pause();
                        }}
                        className="min-h-[36px] bg-white px-3 py-2 text-ink shadow-none"
                      >
                        Jump
                      </ActionButton>
                      <ActionButton
                        onClick={() => setCineEvents((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                        className="min-h-[36px] bg-white px-3 py-2 text-ink shadow-none"
                      >
                        Delete
                      </ActionButton>
                    </div>
                  </div>
                ))
              )}
            </div>
            <h2 className="mt-6 text-[26px] font-semibold tracking-tight text-ink">Cine Motion JSON</h2>
            <pre className="mt-4 max-h-[180px] overflow-auto rounded-[20px] border border-line bg-[#f8fafc] p-4 text-xs leading-6 text-[#344054]">
              {cineJson}
            </pre>
          </>
        ) : (
          <>
            <h2 className="mt-6 text-[26px] font-semibold tracking-tight text-ink">Project</h2>
            <pre className="mt-4 h-[260px] overflow-auto rounded-[20px] border border-line bg-[#f8fafc] p-4 text-xs leading-6 text-[#344054]">
              {projectInfo}
            </pre>
          </>
        )}
      </section>
    </div>
  );
}
