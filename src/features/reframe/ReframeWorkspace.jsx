import { useEffect, useMemo, useState } from "react";
import { FolderOpen, MoveRight, PlaySquare, ScanFace, Sparkles, Video } from "lucide-react";

import { invoke } from "../../lib/tauri";
import PreReframeWorkspace from "../preReframe/PreReframeWorkspace";

const SETTINGS_KEY = "naVShorts.reframe.v2";
const DEFAULT_FACE_FOLDER = "S:\\tools\\codex\\waka_images";
const ENGINE_PRESETS = {
  faceIdentity: { trackingStrength: 0.78, identityThreshold: 0.58, stability: 0.76 },
  yoloDeepsortPerson: { trackingStrength: 0.8, identityThreshold: 0.6, stability: 0.74 },
  yoloBytetrackArcface: { trackingStrength: 0.84, identityThreshold: 0.66, stability: 0.82 },
  manualAssistJson: { trackingStrength: 0.72, identityThreshold: 0.58, stability: 0.84 },
};

const DEFAULT_CONFIG = {
  targetFaceFolder: DEFAULT_FACE_FOLDER,
  assistJsonDir: "",
  previewProxyDir: "",
  configPath: "",
  defaultReframeEngine: "manualAssistJson",
};

const ENGINE_OPTIONS = [
  { value: "faceIdentity", label: "Face Identity (ONNX)" },
  { value: "yoloDeepsortPerson", label: "Person YOLO + DeepSORT" },
  { value: "yoloBytetrackArcface", label: "Person YOLO + ByteTrack + ArcFace" },
  { value: "manualAssistJson", label: "Manual Assist JSON" },
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

function buildOutputPath(inputFullPath) {
  const normalized = inputFullPath.replace(/\//g, "\\");
  const lastSlash = normalized.lastIndexOf("\\");
  const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : "";
  const file = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const dot = file.lastIndexOf(".");
  const base = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : ".mp4";
  return `${dir}${base}_reframed_${timestampYYMMDDhhmmss()}${ext}`;
}

function directoryOf(pathValue) {
  const normalized = (pathValue || "").replace(/\//g, "\\");
  const lastSlash = normalized.lastIndexOf("\\");
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : "";
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

export default function ReframeWorkspace({ onSendToMotion }) {
  const [appConfig, setAppConfig] = useState(DEFAULT_CONFIG);
  const [sourceVideoPath, setSourceVideoPath] = useState("");
  const [targetFacePath, setTargetFacePath] = useState(DEFAULT_FACE_FOLDER);
  const [assistJsonPath, setAssistJsonPath] = useState("");
  const [reframeOutputPath, setReframeOutputPath] = useState("");
  const [encoder, setEncoder] = useState("auto");
  const [trackingEngine, setTrackingEngine] = useState("manualAssistJson");
  const [engineSettings, setEngineSettings] = useState({});
  const [trackingStrength, setTrackingStrength] = useState(0.72);
  const [identityThreshold, setIdentityThreshold] = useState(0.58);
  const [stability, setStability] = useState(0.68);
  const [projectInfo, setProjectInfo] = useState("No video loaded.");
  const [statusText, setStatusText] = useState("Idle.");
  const [progress, setProgress] = useState(0);
  const [etaInfo, setEtaInfo] = useState("Idle");
  const [lastOutput, setLastOutput] = useState("");
  const [isRendering, setIsRendering] = useState(false);
  const [renderModeLabel, setRenderModeLabel] = useState("");
  const [statusLevel, setStatusLevel] = useState("idle");
  const [assistState, setAssistState] = useState({
    sourceVideoPath: "",
    targetFacePath: "",
    assistJsonPath: "",
    assistTrackingEngine: "yoloBytetrackArcface",
    anchors: [],
  });

  const manualEngine = trackingEngine === "manualAssistJson";

  const saveSettings = (override = {}) => {
    const nextEngineSettings = {
      ...engineSettings,
      [trackingEngine]: {
        trackingStrength,
        identityThreshold,
        stability,
      },
    };
    const payload = {
      encoder,
      trackingEngine,
      targetFacePath: targetFacePath.trim(),
      assistJsonPath: assistJsonPath.trim(),
      engineSettings: nextEngineSettings,
      ...override,
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
    setEngineSettings(nextEngineSettings);
  };

  const persistSettingsWithoutStateWrite = (engine, values, override = {}) => {
    const nextEngineSettings = {
      ...engineSettings,
      [engine]: values,
    };
    const payload = {
      encoder,
      trackingEngine: engine,
      targetFacePath: targetFacePath.trim(),
      assistJsonPath: assistJsonPath.trim(),
      engineSettings: nextEngineSettings,
      ...override,
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      const cachedSettings = saved?.engineSettings && typeof saved.engineSettings === "object" ? saved.engineSettings : {};
      setEngineSettings(cachedSettings);
      if (typeof saved.encoder === "string") setEncoder(saved.encoder);
      if (typeof saved.trackingEngine === "string") setTrackingEngine(saved.trackingEngine);
      if (typeof saved.targetFacePath === "string" && saved.targetFacePath.trim()) setTargetFacePath(saved.targetFacePath);
      if (typeof saved.assistJsonPath === "string" && saved.assistJsonPath.trim()) setAssistJsonPath(saved.assistJsonPath);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    invoke("get_app_config")
      .then((cfg) => {
        const nextConfig = {
          targetFaceFolder: cfg.targetFaceFolder || DEFAULT_FACE_FOLDER,
          assistJsonDir: cfg.assistJsonDir || "",
          previewProxyDir: cfg.previewProxyDir || "",
          configPath: cfg.configPath || "",
          defaultReframeEngine: cfg.reframeDefaultEngine || "manualAssistJson",
        };
        setAppConfig(nextConfig);
        setTargetFacePath((current) => (current.trim() ? current : nextConfig.targetFaceFolder));
        setTrackingEngine((current) => current || nextConfig.defaultReframeEngine);
      })
      .catch(() => {
        // ignore
      });
  }, []);

  useEffect(() => {
    const settings = engineSettings[trackingEngine] || ENGINE_PRESETS[trackingEngine] || ENGINE_PRESETS.faceIdentity;
    setTrackingStrength(settings.trackingStrength);
    setIdentityThreshold(settings.identityThreshold);
    setStability(settings.stability);
  }, [engineSettings, trackingEngine]);

  useEffect(() => {
    persistSettingsWithoutStateWrite(
      trackingEngine,
      {
        trackingStrength,
        identityThreshold,
        stability,
      },
    );
  }, [assistJsonPath, encoder, engineSettings, identityThreshold, stability, targetFacePath, trackingEngine, trackingStrength]);

  useEffect(() => {
    invoke("get_project")
      .then((project) => setProjectInfo(JSON.stringify(project, null, 2)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!manualEngine) return;
    if (assistState.sourceVideoPath && assistState.sourceVideoPath !== sourceVideoPath) {
      setSourceVideoPath(assistState.sourceVideoPath);
      setReframeOutputPath((current) => current || buildOutputPath(assistState.sourceVideoPath));
    }
    if (assistState.targetFacePath && assistState.targetFacePath !== targetFacePath) {
      setTargetFacePath(assistState.targetFacePath);
    }
    if (assistState.assistJsonPath && assistState.assistJsonPath !== assistJsonPath) {
      setAssistJsonPath(assistState.assistJsonPath);
    }
  }, [assistJsonPath, assistState, manualEngine, sourceVideoPath, targetFacePath]);

  const openSourceVideo = async () => {
    try {
      const picked = await invoke("pick_video_file");
      if (!picked) {
        setStatusText("Video selection cancelled.");
        return;
      }
      await invoke("open_video", { path: picked });
      setSourceVideoPath(picked);
      setReframeOutputPath(buildOutputPath(picked));
      setStatusText("Source video loaded for Reframe.");
    } catch (error) {
      setStatusText(String(error));
    }
  };

  const pickTargetFaceFolder = async () => {
    try {
      const picked = await invoke("pick_folder_with_default", {
        startDir: targetFacePath.trim() || appConfig.targetFaceFolder || null,
      });
      if (!picked) {
        setStatusText("Face folder selection cancelled.");
        return;
      }
      setTargetFacePath(picked);
      setStatusText("Target face folder selected.");
    } catch (error) {
      setStatusText(String(error));
    }
  };

  const pickAssistJson = async () => {
    try {
      const picked = await invoke("pick_json_file_with_default", {
        startDir: directoryOf(assistJsonPath) || appConfig.assistJsonDir || directoryOf(sourceVideoPath) || null,
      });
      if (!picked) {
        setStatusText("Assist JSON selection cancelled.");
        return;
      }
      setAssistJsonPath(picked);
      setTrackingEngine("manualAssistJson");
      setStatusText("Assist JSON selected.");
    } catch (error) {
      setStatusText(String(error));
    }
  };

  const scoreFaceFolder = async (moveExcluded) => {
    try {
      if (!targetFacePath.trim()) {
        setStatusText("Target face folder path is empty.");
        return;
      }
      const command = moveExcluded ? "score_and_move_face_folder" : "score_face_folder";
      const result = await invoke(command, { path: targetFacePath.trim() });
      setStatusText(JSON.stringify(result, null, 2));
    } catch (error) {
      setStatusText(String(error));
    }
  };

  const trackRenderJob = async (jobId) => {
    const startedAt = Date.now();
    setIsRendering(true);
    setProgress(0);
    setEtaInfo("Starting...");
    setStatusLevel("running");
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
            setStatusLevel("running");
          } else if (status.state === "completed") {
            setProgress(1);
            setEtaInfo("Completed");
            setStatusLevel("success");
          } else if (["failed", "cancelled"].includes(status.state)) {
            setProgress(p);
            setEtaInfo(`Stopped (${status.state})`);
            setStatusLevel("error");
          }

          if (["completed", "failed", "cancelled"].includes(status.state)) {
            clearInterval(timer);
            setIsRendering(false);
            resolve(status);
          }
        } catch (error) {
          clearInterval(timer);
          setIsRendering(false);
          setStatusLevel("error");
          setStatusText(String(error));
          setProgress(0);
          setEtaInfo("Error");
          resolve(null);
        }
      }, 800);
    });
  };

  const startReframeRender = async (preview) => {
    try {
      saveSettings();
      setRenderModeLabel(preview ? "Preview render" : "Final export");
      const input = sourceVideoPath.trim();
      const out = reframeOutputPath.trim();
      const face = targetFacePath.trim();
      const assistJson = assistJsonPath.trim();

      if (!input) {
        setStatusLevel("error");
        setStatusText("Source video path is empty.");
        return;
      }
      if (!out) {
        setStatusLevel("error");
        setStatusText("Reframe output path is empty.");
        return;
      }
      if (trackingEngine === "manualAssistJson" && !assistJson) {
        setStatusLevel("error");
        setStatusText("Assist JSON path is empty.");
        return;
      }

      if (trackingEngine === "manualAssistJson") {
        if (!assistState.sourceVideoPath.trim()) {
          setStatusLevel("error");
          setStatusText("Assist source video path is empty.");
          return;
        }
        if (assistState.anchors.length < 2) {
          setStatusLevel("error");
          setStatusText("Add at least 2 assist anchors before export.");
          return;
        }

        setStatusText("Saving Assist JSON before export...");
        await invoke("save_manual_assist_json", {
          path: assistJson,
          sourceVideo: assistState.sourceVideoPath.trim(),
          targetFacePath: (assistState.targetFacePath || targetFacePath).trim() || null,
          assistTrackingEngine: assistState.assistTrackingEngine || "yoloBytetrackArcface",
          anchors: assistState.anchors,
        });
      }

      setStatusLevel("running");
      setStatusText(`${preview ? "Preview render" : "Final export"} requested. Preparing render job...`);

      const jobId = await invoke("render_reframe", {
        request: {
          inputPath: input,
          outputPath: out,
          targetFacePath: face || null,
          assistJsonPath: assistJson || null,
          preview,
          encoder,
          trackingStrength,
          identityThreshold,
          stability,
          trackingEngine,
        },
      });

      const status = await trackRenderJob(jobId);
      if (status && status.state === "completed") {
        setLastOutput(out);
        const sourceRef = trackingEngine === "manualAssistJson" ? assistJson : face || "(none)";
        setStatusLevel("success");
        setStatusText(
          `Reframe complete. Source reference: ${sourceRef} | tracking=${trackingStrength.toFixed(2)} id=${identityThreshold.toFixed(2)} stability=${stability.toFixed(2)} engine=${trackingEngine}`,
        );
      } else if (status && status.state === "failed") {
        setStatusLevel("error");
      }
    } catch (error) {
      setIsRendering(false);
      setStatusLevel("error");
      setStatusText(String(error));
    }
  };

  const sendToMotion = () => {
    const path = (lastOutput || reframeOutputPath || "").trim();
    if (!path) {
      setStatusLevel("error");
      setStatusText("No reframed output path available.");
      return;
    }
    onSendToMotion?.(path);
  };

  const projectInfoText = useMemo(() => projectInfo, [projectInfo]);
  const parsedStatus = useMemo(() => {
    try {
      const value = JSON.parse(statusText);
      return value && typeof value === "object" ? value : null;
    } catch {
      return null;
    }
  }, [statusText]);
  const primaryStatusMessage =
    parsedStatus && typeof parsedStatus.message === "string" && parsedStatus.message.trim()
      ? parsedStatus.message
      : statusText;
  const statusBadgeClass =
    statusLevel === "running"
      ? "bg-[#e8f1ff] text-[#0057b8]"
      : statusLevel === "success"
        ? "bg-[#ecfdf3] text-[#027a48]"
        : statusLevel === "error"
          ? "bg-[#fef3f2] text-[#b42318]"
          : "bg-[#f4f6f8] text-muted";

  return (
    <div className="grid min-h-full grid-cols-[minmax(0,1.45fr)_360px] gap-4">
      <section className="rounded-[28px] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur-xl">
        <h1 className="text-[34px] font-semibold tracking-tight text-ink">Reframe Workspace</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Convert the source into a vertical 9:16 output. When you use Manual Assist JSON, anchor editing and export now live in one continuous workflow.
        </p>

        <div className="mt-5 inline-flex rounded-full border border-line bg-[#f8fafc] p-1 text-sm shadow-panel">
          {[
            { id: "assist", label: "1. Assist" },
            { id: "export", label: "2. Export" },
          ].map((step) => (
            <div
              key={step.id}
              className={[
                "rounded-full px-4 py-2 font-semibold",
                step.id === "assist" && manualEngine ? "bg-accent text-white" : "text-[#475467]",
                step.id === "export" ? "bg-white text-ink shadow-[0_8px_18px_rgba(15,23,42,0.06)]" : "",
              ].join(" ")}
            >
              {step.label}
            </div>
          ))}
        </div>

        {manualEngine ? (
          <div className="mt-5">
            <PreReframeWorkspace
              embedded
              onAssistStateChange={(nextState) => {
                setAssistState({
                  sourceVideoPath: nextState.sourceVideoPath || "",
                  targetFacePath: nextState.targetFacePath || "",
                  assistJsonPath: nextState.assistJsonPath || "",
                  assistTrackingEngine: nextState.assistTrackingEngine || "yoloBytetrackArcface",
                  anchors: Array.isArray(nextState.anchors) ? nextState.anchors : [],
                });
              }}
            />
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3 rounded-[20px] border border-line bg-white px-4 py-3 shadow-[0_8px_18px_rgba(15,23,42,0.04)]">
          <div>
            <div className="text-sm font-semibold text-ink">Render action</div>
            <div className="mt-1 text-sm text-muted">
              {isRendering ? `${renderModeLabel} is running...` : renderModeLabel ? `${renderModeLabel} is ready.` : "Choose preview or final export."}
            </div>
          </div>
          <div className={`rounded-full px-3 py-2 text-sm font-semibold ${statusBadgeClass}`}>
            {isRendering ? "Running" : etaInfo}
          </div>
        </div>

        <div className="mt-5 grid gap-3 rounded-[24px] border border-line bg-[#f8fafc]/80 p-4">
          <h2 className="text-[28px] font-semibold tracking-tight text-ink">
            {manualEngine ? "Step 2. Export Settings" : "Export Settings"}
          </h2>
          {manualEngine ? (
            <div className="rounded-[20px] border border-line bg-[#fbfcfe] px-4 py-3 text-sm leading-6 text-muted">
              This export section uses the source path, target face folder, and Assist JSON from the anchor workflow above.
            </div>
          ) : null}
          <div className="grid gap-2">
            <div className="text-sm font-semibold text-[#344054]">Source video path</div>
            <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-3">
              <input value={sourceVideoPath} readOnly className="app-input app-input-readonly" />
              <ActionButton icon={FolderOpen} onClick={openSourceVideo} disabled={manualEngine} className="app-btn-primary disabled:cursor-not-allowed disabled:opacity-50">
                Select Source Video
              </ActionButton>
            </div>
          </div>

          <div className="grid gap-2">
            <div className="text-sm font-semibold text-[#344054]">Target face folder path</div>
            <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-3">
              <input value={targetFacePath} readOnly className="app-input app-input-readonly" />
              <ActionButton
                icon={FolderOpen}
                onClick={pickTargetFaceFolder}
                disabled={manualEngine}
                className="app-btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                Select Target Face Folder
              </ActionButton>
            </div>
          </div>

          <div className="grid gap-2">
            <div className="text-sm font-semibold text-[#344054]">Assist JSON path</div>
            <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-3">
              <input value={assistJsonPath} readOnly className="app-input app-input-readonly" />
              <ActionButton
                icon={FolderOpen}
                onClick={pickAssistJson}
                disabled={manualEngine}
                className="app-btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                Select Assist JSON
              </ActionButton>
            </div>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
            <Field label="Tracking engine">
              <select
                value={trackingEngine}
                onChange={(event) => setTrackingEngine(event.target.value)}
                className="app-select"
              >
                {ENGINE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3 self-end">
              <ActionButton
                icon={ScanFace}
                onClick={() => scoreFaceFolder(false)}
                disabled={manualEngine}
                className="app-btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
              >
                Score Face Folder
              </ActionButton>
              <ActionButton
                icon={Sparkles}
                onClick={() => scoreFaceFolder(true)}
                disabled={manualEngine}
                className="app-btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
              >
                Score + Move Excluded
              </ActionButton>
            </div>
          </div>

          <div className="grid grid-cols-[220px_72px_minmax(0,1fr)] items-center gap-3">
            <div className="text-sm font-semibold text-[#344054]">Face tracking strength</div>
            <div className="text-right text-sm font-semibold text-[#0f172a]">{trackingStrength.toFixed(2)}</div>
            <input type="range" min="0" max="1" step="0.01" value={trackingStrength} onChange={(e) => setTrackingStrength(Number(e.target.value))} />
          </div>

          <div className="grid grid-cols-[220px_72px_minmax(0,1fr)] items-center gap-3">
            <div className="text-sm font-semibold text-[#344054]">Identity threshold</div>
            <div className="text-right text-sm font-semibold text-[#0f172a]">{identityThreshold.toFixed(2)}</div>
            <input type="range" min="0" max="1" step="0.01" value={identityThreshold} onChange={(e) => setIdentityThreshold(Number(e.target.value))} />
          </div>

          <div className="grid grid-cols-[220px_72px_minmax(0,1fr)] items-center gap-3">
            <div className="text-sm font-semibold text-[#344054]">Stability</div>
            <div className="text-right text-sm font-semibold text-[#0f172a]">{stability.toFixed(2)}</div>
            <input type="range" min="0" max="1" step="0.01" value={stability} onChange={(e) => setStability(Number(e.target.value))} />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-4">
            <Field label="Reframe output path">
              <input
                value={reframeOutputPath}
                onChange={(event) => setReframeOutputPath(event.target.value)}
                placeholder="C:\\videos\\source_reframed_yymmddhhmmss.mp4"
                className="app-input"
              />
            </Field>
            <Field label="Video encoder">
              <select value={encoder} onChange={(event) => setEncoder(event.target.value)} className="app-select">
                {ENCODER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <ActionButton icon={PlaySquare} onClick={() => startReframeRender(true)} disabled={isRendering} className="app-btn-ghost disabled:cursor-not-allowed disabled:opacity-50">
            {isRendering && renderModeLabel === "Preview render" ? "Rendering Preview..." : "Render Reframe Preview"}
          </ActionButton>
          <ActionButton icon={Video} onClick={() => startReframeRender(false)} disabled={isRendering} className="app-btn-primary disabled:cursor-not-allowed disabled:opacity-50">
            {isRendering && renderModeLabel === "Final export" ? "Exporting..." : "Export Reframed Video"}
          </ActionButton>
        </div>

        <div className="mt-3">
          <ActionButton icon={MoveRight} onClick={sendToMotion} className="app-btn-secondary w-full">
            Send Reframed Video To Motion
          </ActionButton>
        </div>
      </section>

      <section className="rounded-[28px] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-[26px] font-semibold tracking-tight text-ink">Status</h2>
          <div className={`rounded-full px-3 py-1.5 text-sm font-semibold ${statusBadgeClass}`}>{etaInfo}</div>
        </div>
        <div className="mt-4 h-2 rounded-full bg-[#e5e7eb]">
          <div className="h-2 rounded-full bg-accent transition-all" style={{ width: `${Math.max(0, Math.min(progress, 1)) * 100}%` }} />
        </div>
        <div className="mt-4 rounded-[18px] border border-line bg-white px-4 py-3 text-sm leading-6 text-ink">
          {primaryStatusMessage}
        </div>
        {statusLevel === "error" ? (
          <div className="mt-4 rounded-[18px] border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm leading-6 text-[#b42318]">
            Render failed. Check the detailed status output below for the last error or failed-state payload.
          </div>
        ) : null}
        <pre className="mt-4 h-[220px] overflow-auto rounded-[20px] border border-line bg-[#f8fafc] p-4 text-xs leading-6 text-[#344054]">
          {statusText}
        </pre>

        <h2 className="mt-6 text-[26px] font-semibold tracking-tight text-ink">Project</h2>
        <pre className="mt-4 h-[260px] overflow-auto rounded-[20px] border border-line bg-[#f8fafc] p-4 text-xs leading-6 text-[#344054]">
          {projectInfoText}
        </pre>
      </section>
    </div>
  );
}
