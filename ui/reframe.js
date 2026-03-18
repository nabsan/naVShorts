function resolveInvoke() {
  const modern = window.__TAURI__?.core?.invoke;
  if (typeof modern === "function") return modern;

  const legacy = window.__TAURI__?.tauri?.invoke;
  if (typeof legacy === "function") return legacy;

  const internal = window.__TAURI_INTERNALS__?.invoke;
  if (typeof internal === "function") return (cmd, payload) => internal(cmd, payload);

  return null;
}

const tauriInvoke = resolveInvoke();
const $ = (id) => document.getElementById(id);

const SETTINGS_KEY = "naVShorts.reframe.v2";
const DEFAULT_FACE_FOLDER = "S:\\tools\\codex\\waka_images";
const ENGINE_PRESETS = {
  faceIdentity: { trackingStrength: 0.78, identityThreshold: 0.58, stability: 0.76 },
  yoloDeepsortPerson: { trackingStrength: 0.80, identityThreshold: 0.60, stability: 0.74 },
  yoloBytetrackArcface: { trackingStrength: 0.84, identityThreshold: 0.66, stability: 0.82 },
  manualAssistJson: { trackingStrength: 0.72, identityThreshold: 0.58, stability: 0.84 },
};

const sourceVideoPath = $("sourceVideoPath");
const targetFacePath = $("targetFacePath");
const assistJsonPath = $("assistJsonPath");
const pickTargetFaceBtn = $("pickTargetFaceBtn");
const pickAssistJsonBtn = $("pickAssistJsonBtn");
const scoreFaceFolderBtn = $("scoreFaceFolderBtn");
const moveExcludedBtn = $("moveExcludedBtn");
const reframeOutputPath = $("reframeOutputPath");
const encoder = $("encoder");
const trackingEngine = $("trackingEngine");
const trackingStrength = $("trackingStrength");
const trackingStrengthValue = $("trackingStrengthValue");
const identityThreshold = $("identityThreshold");
const identityThresholdValue = $("identityThresholdValue");
const stability = $("stability");
const stabilityValue = $("stabilityValue");

const projectInfo = $("projectInfo");
const statusInfo = $("statusInfo");
const renderProgress = $("renderProgress");
const etaInfo = $("etaInfo");

let lastOutput = "";
let reframeSettingsCache = { engineSettings: {} };
let currentEngineKey = "faceIdentity";

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

function printProject(data) {
  projectInfo.textContent = JSON.stringify(data, null, 2);
}

function printStatus(textOrObject) {
  statusInfo.textContent = typeof textOrObject === "string" ? textOrObject : JSON.stringify(textOrObject, null, 2);
}

function setProgress(progress, etaText) {
  renderProgress.value = Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0;
  etaInfo.textContent = etaText;
}

function getSelectedEngine() {
  return trackingEngine ? trackingEngine.value : "faceIdentity";
}

function getEnginePreset(engine) {
  return ENGINE_PRESETS[engine] || ENGINE_PRESETS.faceIdentity;
}

function syncSliderLabels() {
  if (trackingStrength && trackingStrengthValue) trackingStrengthValue.textContent = Number(trackingStrength.value).toFixed(2);
  if (identityThreshold && identityThresholdValue) identityThresholdValue.textContent = Number(identityThreshold.value).toFixed(2);
  if (stability && stabilityValue) stabilityValue.textContent = Number(stability.value).toFixed(2);
}

function captureCurrentEngineSettings() {
  return {
    trackingStrength: Number(trackingStrength?.value ?? 0.72),
    identityThreshold: Number(identityThreshold?.value ?? 0.58),
    stability: Number(stability?.value ?? 0.68),
  };
}

function updateTrackingEngineUi() {
  const engine = getSelectedEngine();
  const manual = engine === "manualAssistJson";
  if (targetFacePath) targetFacePath.disabled = manual;
  if (pickTargetFaceBtn) pickTargetFaceBtn.disabled = manual;
  if (scoreFaceFolderBtn) scoreFaceFolderBtn.disabled = manual;
  if (moveExcludedBtn) moveExcludedBtn.disabled = manual;
  if (assistJsonPath) assistJsonPath.disabled = !manual;
  if (pickAssistJsonBtn) pickAssistJsonBtn.disabled = !manual;
}

function applyEngineSettings(engine, settings, persist = false) {
  const next = settings || getEnginePreset(engine);
  trackingStrength.value = String(next.trackingStrength);
  identityThreshold.value = String(next.identityThreshold);
  stability.value = String(next.stability);
  syncSliderLabels();
  updateTrackingEngineUi();
  if (persist) saveSettings();
}

function bindSlider(inputEl, labelEl) {
  if (!inputEl || !labelEl) return;
  const sync = () => {
    labelEl.textContent = Number(inputEl.value).toFixed(2);
  };
  inputEl.addEventListener("input", () => {
    sync();
    saveSettings();
  });
  inputEl.addEventListener("change", saveSettings);
  sync();
}

function loadSettings() {
  targetFacePath.value = DEFAULT_FACE_FOLDER;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      currentEngineKey = getSelectedEngine();
      applyEngineSettings(currentEngineKey, getEnginePreset(currentEngineKey), false);
      return;
    }
    const s = JSON.parse(raw);
    reframeSettingsCache = s && typeof s === "object" ? s : { engineSettings: {} };
    if (typeof s.encoder === "string") encoder.value = s.encoder;
    if (typeof s.trackingEngine === "string" && trackingEngine) trackingEngine.value = s.trackingEngine;
    if (typeof s.targetFacePath === "string" && s.targetFacePath.trim()) targetFacePath.value = s.targetFacePath;
    if (typeof s.assistJsonPath === "string" && s.assistJsonPath.trim()) assistJsonPath.value = s.assistJsonPath;
    currentEngineKey = getSelectedEngine();
    const engineSettings = reframeSettingsCache.engineSettings || {};
    const selectedSettings = engineSettings[currentEngineKey] || getEnginePreset(currentEngineKey);
    reframeSettingsCache.engineSettings = engineSettings;
    applyEngineSettings(currentEngineKey, selectedSettings, false);
  } catch {
    currentEngineKey = getSelectedEngine();
    applyEngineSettings(currentEngineKey, getEnginePreset(currentEngineKey), false);
  }
}

function saveSettings() {
  const engine = getSelectedEngine();
  const engineSettings = reframeSettingsCache.engineSettings || {};
  engineSettings[engine] = captureCurrentEngineSettings();
  const payload = {
    encoder: encoder.value,
    trackingEngine: engine,
    targetFacePath: targetFacePath.value.trim(),
    assistJsonPath: assistJsonPath.value.trim(),
    engineSettings,
  };
  reframeSettingsCache = payload;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
}

function handleTrackingEngineChange() {
  const nextEngine = getSelectedEngine();
  const engineSettings = reframeSettingsCache.engineSettings || {};
  engineSettings[currentEngineKey] = captureCurrentEngineSettings();
  const nextSettings = engineSettings[nextEngine] || getEnginePreset(nextEngine);
  reframeSettingsCache.engineSettings = engineSettings;
  currentEngineKey = nextEngine;
  applyEngineSettings(nextEngine, nextSettings, true);
  printStatus(
    `Tracking engine preset loaded: ${nextEngine} | tracking=${Number(nextSettings.trackingStrength).toFixed(2)} id=${Number(nextSettings.identityThreshold).toFixed(2)} stability=${Number(nextSettings.stability).toFixed(2)}`
  );
}

async function invoke(cmd, payload) {
  if (!tauriInvoke) {
    throw new Error("Tauri API not available");
  }
  return tauriInvoke(cmd, payload);
}

async function refreshProject() {
  const project = await invoke("get_project");
  printProject(project);
}

async function verifyTools() {
  try {
    const ff = await invoke("verify_runtime_tools");
    const onnx = await invoke("verify_onnx_runtime_assets");
    printStatus({ ffmpeg: ff, onnx });
  } catch (e) {
    printStatus(String(e));
  }
}

async function trackRenderJob(jobId) {
  const startedAt = Date.now();
  setProgress(0, "Starting...");
  printStatus({ jobId, state: "queued" });

  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      try {
        const status = await invoke("get_render_status", { jobId });
        printStatus(status);

        const p = Number(status.progress || 0);
        if (p > 0 && p < 1) {
          const elapsedSec = (Date.now() - startedAt) / 1000;
          const totalSec = elapsedSec / p;
          const remainSec = Math.max(0, totalSec - elapsedSec);
          setProgress(p, `Progress ${(p * 100).toFixed(1)}% | ETA ${Math.ceil(remainSec)}s`);
        } else if (status.state === "completed") {
          setProgress(1, "Completed");
        } else if (["failed", "cancelled"].includes(status.state)) {
          setProgress(p, `Stopped (${status.state})`);
        }

        if (["completed", "failed", "cancelled"].includes(status.state)) {
          clearInterval(timer);
          resolve(status);
        }
      } catch (err) {
        clearInterval(timer);
        printStatus(String(err));
        setProgress(0, "Error");
        resolve(null);
      }
    }, 800);
  });
}

async function startReframeRender(preview) {
  try {
    saveSettings();
    const input = sourceVideoPath.value.trim();
    const out = reframeOutputPath.value.trim();
    const face = targetFacePath.value.trim();
    const assistJson = assistJsonPath.value.trim();
    const tracking = Number(trackingStrength?.value ?? 0.72);
    const idThr = Number(identityThreshold?.value ?? 0.58);
    const stab = Number(stability?.value ?? 0.68);
    const engine = trackingEngine ? trackingEngine.value : "faceIdentity";

    if (!input) {
      printStatus("Source video path is empty.");
      return;
    }
    if (!out) {
      printStatus("Reframe output path is empty.");
      return;
    }
    if (engine === "manualAssistJson" && !assistJson) {
      printStatus("Assist JSON path is empty.");
      return;
    }

    const jobId = await invoke("render_reframe", {
      request: {
        inputPath: input,
        outputPath: out,
        targetFacePath: face || null,
        assistJsonPath: assistJson || null,
        preview,
        encoder: encoder.value,
        trackingStrength: Number.isFinite(tracking) ? tracking : 0.72,
        identityThreshold: Number.isFinite(idThr) ? idThr : 0.58,
        stability: Number.isFinite(stab) ? stab : 0.68,
        trackingEngine: engine,
      },
    });

    const status = await trackRenderJob(jobId);
    if (status && status.state === "completed") {
      lastOutput = out;
      const sourceRef = engine === "manualAssistJson" ? assistJson : face || "(none)";
      printStatus(`Reframe complete. Source reference: ${sourceRef} | tracking=${tracking.toFixed(2)} id=${idThr.toFixed(2)} stability=${stab.toFixed(2)} engine=${engine}`);
    }
  } catch (e) {
    printStatus(String(e));
  }
}

loadSettings();
bindSlider(trackingStrength, trackingStrengthValue);
bindSlider(identityThreshold, identityThresholdValue);
bindSlider(stability, stabilityValue);
syncSliderLabels();
updateTrackingEngineUi();
encoder.addEventListener("change", saveSettings);
if (trackingEngine) trackingEngine.addEventListener("change", handleTrackingEngineChange);

$("verifyBtn").addEventListener("click", verifyTools);

if (pickTargetFaceBtn) {
  pickTargetFaceBtn.addEventListener("click", async () => {
    try {
      const picked = await invoke("pick_folder");
      if (!picked) {
        printStatus("Face folder selection cancelled.");
        return;
      }
      targetFacePath.value = picked;
      saveSettings();
      printStatus("Target face folder selected.");
    } catch (e) {
      printStatus(String(e));
    }
  });
}

if (pickAssistJsonBtn) {
  pickAssistJsonBtn.addEventListener("click", async () => {
    try {
      const picked = await invoke("pick_json_file");
      if (!picked) {
        printStatus("Assist JSON selection cancelled.");
        return;
      }
      assistJsonPath.value = picked;
      const assistProject = await invoke("load_manual_assist_json", { path: picked });
      if (typeof assistProject.targetFacePath === "string" && assistProject.targetFacePath.trim()) {
        targetFacePath.value = assistProject.targetFacePath;
      }
      trackingEngine.value = "manualAssistJson";
      handleTrackingEngineChange();
      saveSettings();
      printStatus("Assist JSON selected.");
    } catch (e) {
      printStatus(String(e));
    }
  });
}

if (scoreFaceFolderBtn) {
  scoreFaceFolderBtn.addEventListener("click", async () => {
    try {
      const folder = (targetFacePath.value || "").trim();
      if (!folder) {
        printStatus("Target face folder path is empty.");
        return;
      }
      printStatus("Scoring face folder...");
      const result = await invoke("score_face_folder", { path: folder });
      printStatus(result);
    } catch (e) {
      printStatus(String(e));
    }
  });
}

if (moveExcludedBtn) {
  moveExcludedBtn.addEventListener("click", async () => {
    try {
      const folder = (targetFacePath.value || "").trim();
      if (!folder) {
        printStatus("Target face folder path is empty.");
        return;
      }
      printStatus("Scoring and moving excluded files to botu...");
      const result = await invoke("score_and_move_face_folder", { path: folder });
      printStatus(result);
    } catch (e) {
      printStatus(String(e));
    }
  });
}

$("openSourceBtn").addEventListener("click", async () => {
  try {
    const picked = await invoke("pick_video_file");
    if (!picked) {
      printStatus("Video selection cancelled.");
      return;
    }
    sourceVideoPath.value = picked;
    await invoke("open_video", { path: picked });
    reframeOutputPath.value = buildOutputPath(picked);
    printStatus("Source video loaded for Reframe.");
    await refreshProject();
  } catch (e) {
    printStatus(String(e));
  }
});

$("previewBtn").addEventListener("click", () => startReframeRender(true));
$("exportBtn").addEventListener("click", () => startReframeRender(false));

$("sendToEffectsBtn").addEventListener("click", () => {
  const path = (lastOutput || reframeOutputPath.value || "").trim();
  if (!path) {
    printStatus("No reframed output path available.");
    return;
  }
  const u = new URL("./index.html", window.location.href);
  u.searchParams.set("reframed", path);
  window.location.href = u.toString();
});

const assistJsonFromUrl = new URLSearchParams(window.location.search).get("assistJson");
if (assistJsonFromUrl) {
  assistJsonPath.value = assistJsonFromUrl;
  invoke("load_manual_assist_json", { path: assistJsonFromUrl })
    .then((assistProject) => {
      if (typeof assistProject.targetFacePath === "string" && assistProject.targetFacePath.trim()) {
        targetFacePath.value = assistProject.targetFacePath;
      }
      if (trackingEngine) trackingEngine.value = "manualAssistJson";
      currentEngineKey = "manualAssistJson";
      applyEngineSettings(currentEngineKey, getEnginePreset(currentEngineKey), false);
      saveSettings();
      printStatus("Assist JSON received from Reframe Assist. Export from 1. Reframe when ready.");
    })
    .catch(() => {
      if (trackingEngine) trackingEngine.value = "manualAssistJson";
      currentEngineKey = "manualAssistJson";
      applyEngineSettings(currentEngineKey, getEnginePreset(currentEngineKey), false);
      saveSettings();
      printStatus("Assist JSON received from Reframe Assist. Export from 1. Reframe when ready.");
    });
}

if (!tauriInvoke) {
  printStatus("Tauri API not available");
}

setProgress(0, "Idle");
verifyTools().catch(() => {});
refreshProject().catch(() => {});

