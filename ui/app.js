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

const SETTINGS_KEY = "naVShorts.effects.v1";
const RESET_NOTICE_KEY = "naVShorts.resetNotice.v1";
const appConfig = {
  defaultEffectsZoomMode: "zoomSineSmooth",
};

const videoPath = $("videoPath");
const outputPath = $("outputPath");
const projectInfo = $("projectInfo");
const statusInfo = $("statusInfo");
const renderProgress = $("renderProgress");
const etaInfo = $("etaInfo");

const zoomMode = $("zoomMode");
const zoomStrength = $("zoomStrength");
const bounceStrength = $("bounceStrength");
const beatSensitivity = $("beatSensitivity");
const motionBlurStrength = $("motionBlurStrength");

const zoomStrengthValue = $("zoomStrengthValue");
const bounceStrengthValue = $("bounceStrengthValue");
const beatSensitivityValue = $("beatSensitivityValue");
const motionBlurStrengthValue = $("motionBlurStrengthValue");

const preset = $("preset");
const encoder = $("encoder");

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

function buildPreviewOutputPath(currentOutputPath, inputFullPath) {
  const source = (currentOutputPath || "").trim() || buildDefaultOutputPath(inputFullPath || videoPath.value.trim());
  const normalized = source.replace(/\//g, "\\");
  const dot = normalized.lastIndexOf(".");
  if (dot > 0) return `${normalized.slice(0, dot)}_preview${normalized.slice(dot)}`;
  return `${normalized}_preview.mp4`;
}

function printProject(data) {
  projectInfo.textContent = JSON.stringify(data, null, 2);
}

function printStatus(textOrObject) {
  statusInfo.textContent =
    typeof textOrObject === "string"
      ? textOrObject
      : JSON.stringify(textOrObject, null, 2);
}

function syncSliderLabels() {
  zoomStrengthValue.textContent = Number(zoomStrength.value).toFixed(2);
  bounceStrengthValue.textContent = Number(bounceStrength.value).toFixed(2);
  beatSensitivityValue.textContent = Number(beatSensitivity.value).toFixed(2);
  motionBlurStrengthValue.textContent = Number(motionBlurStrength.value).toFixed(2);
}

function setProgress(progress, etaText) {
  renderProgress.value = Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0;
  etaInfo.textContent = etaText;
}

function showResetNoticeIfNeeded() {
  try {
    const raw = localStorage.getItem(RESET_NOTICE_KEY);
    if (!raw) return;
    const payload = JSON.parse(raw);
    if (!payload?.message) return;
    printStatus(payload.message);
    setProgress(0, "Notice");
  } catch {
    // ignore invalid notice
  }
}

async function loadAppConfigDefaults() {
  try {
    const cfg = await invoke("get_app_config");
    appConfig.defaultEffectsZoomMode = cfg.effectsDefaultZoomMode || "zoomSineSmooth";
    const raw = localStorage.getItem(SETTINGS_KEY);
    let saved = null;
    try { saved = raw ? JSON.parse(raw) : null; } catch {}
    if (!saved || typeof saved.zoomMode !== "string") {
      zoomMode.value = appConfig.defaultEffectsZoomMode || "zoomSineSmooth";
    }
  } catch {
    // ignore config load failures
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (typeof s.zoomMode === "string") zoomMode.value = s.zoomMode;
    if (typeof s.zoomStrength === "number") zoomStrength.value = String(s.zoomStrength);
    if (typeof s.bounceStrength === "number") bounceStrength.value = String(s.bounceStrength);
    if (typeof s.beatSensitivity === "number") beatSensitivity.value = String(s.beatSensitivity);
    if (typeof s.motionBlurStrength === "number") motionBlurStrength.value = String(s.motionBlurStrength);
    if (typeof s.preset === "string") preset.value = s.preset;
    if (typeof s.encoder === "string") encoder.value = s.encoder;
  } catch {
    // ignore broken local settings
  }
}

function saveSettings() {
  const payload = {
    zoomMode: zoomMode.value,
    zoomStrength: Number(zoomStrength.value),
    bounceStrength: Number(bounceStrength.value),
    beatSensitivity: Number(beatSensitivity.value),
    motionBlurStrength: Number(motionBlurStrength.value),
    preset: preset.value,
    encoder: encoder.value,
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
}

loadSettings();
loadAppConfigDefaults().then(() => {
  saveSettings();
});
syncSliderLabels();
setProgress(0, "Idle");
showResetNoticeIfNeeded();

[zoomStrength, bounceStrength, beatSensitivity, motionBlurStrength].forEach((el) => {
  el.addEventListener("input", () => {
    syncSliderLabels();
    saveSettings();
  });
  el.addEventListener("change", saveSettings);
});

[zoomMode, preset, encoder].forEach((el) => el.addEventListener("change", saveSettings));

async function invoke(cmd, payload) {
  if (!tauriInvoke) {
    const globals = Object.keys(window)
      .filter((k) => k.includes("TAURI"))
      .join(", ");
    throw new Error(`Tauri API not available. Detected globals: ${globals || "(none)"}`);
  }
  return tauriInvoke(cmd, payload);
}

async function refreshProject() {
  const project = await invoke("get_project");
  printProject(project);
}

function buildEffectsPayload() {
  return {
    zoomMode: zoomMode.value,
    zoomStrength: Number(zoomStrength.value),
    bounceStrength: Number(bounceStrength.value),
    beatSensitivity: Number(beatSensitivity.value),
    motionBlurStrength: Number(motionBlurStrength.value),
  };
}

async function applyEffects() {
  saveSettings();
  const project = await invoke("set_effects", {
    config: buildEffectsPayload(),
  });
  printProject(project);
  return project;
}

async function analyzeBeats() {
  const path = videoPath.value.trim();
  if (!path) throw new Error("Load a video before analyzing beats.");
  const beats = await invoke("analyze_beats", {
    path,
    sensitivity: Number(beatSensitivity.value),
  });
  await refreshProject();
  return beats;
}

async function prepareEffectsForRender(kindLabel) {
  const path = videoPath.value.trim();
  if (!path) throw new Error("Load a video before rendering.");
  setProgress(0, `Auto analyze/apply running for ${kindLabel}...`);
  printStatus(`Auto analyze/apply running for ${kindLabel}: analyzing beats...`);
  const beats = await analyzeBeats();
  setProgress(0, `Auto analyze/apply running for ${kindLabel}...`);
  printStatus(`Auto analyze/apply running for ${kindLabel}: applying effects after ${beats.points.length} beat points...`);
  await applyEffects();
  printStatus(`Auto analyze/apply complete for ${kindLabel}. Beat points: ${beats.points.length}`);
}

$("openBtn").addEventListener("click", async () => {
  try {
    const picked = await invoke("pick_video_file");
    if (!picked) {
      printStatus("Video selection cancelled.");
      return;
    }

    videoPath.value = picked;
    const info = await invoke("open_video", { path: picked });
    outputPath.value = buildDefaultOutputPath(picked);

    printStatus("Video loaded.");
    printProject(info);
    await refreshProject();
  } catch (e) {
    printStatus(String(e));
  }
});

$("saveEffectsBtn").addEventListener("click", async () => {
  try {
    const project = await applyEffects();
    printProject(project);
    printStatus("Effects updated.");
  } catch (e) {
    printStatus(String(e));
  }
});

$("analyzeBtn").addEventListener("click", async () => {
  try {
    printStatus("Analyzing beats...");
    const beats = await analyzeBeats();
    printStatus(`Beat analysis complete: ${beats.points.length} points`);
  } catch (e) {
    printStatus(String(e));
  }
});

async function startRender(preview) {
  try {
    saveSettings();
    const renderKind = preview ? "preview" : "export";
    await prepareEffectsForRender(renderKind);
    const finalOutputPath = preview
      ? buildPreviewOutputPath(outputPath.value.trim(), videoPath.value.trim())
      : outputPath.value.trim();
    const jobId = await invoke("render", {
      request: {
        outputPath: finalOutputPath,
        preset: preset.value,
        preview,
        encoder: encoder.value,
      },
    });

    const startedAt = Date.now();
    setProgress(0, preview ? "Starting preview render..." : "Starting export...");
    printStatus({ jobId, state: "queued", outputPath: finalOutputPath, mode: renderKind });

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
          setProgress(1, preview ? "Preview completed" : "Completed");
        } else if (status.state === "failed" || status.state === "cancelled") {
          setProgress(p, `Stopped (${status.state})`);
        }

        if (["completed", "failed", "cancelled"].includes(status.state)) {
          clearInterval(timer);
        }
      } catch (err) {
        clearInterval(timer);
        printStatus(String(err));
        setProgress(0, "Error");
      }
    }, 800);
  } catch (e) {
    printStatus(String(e));
    setProgress(0, "Error");
  }
}

$("previewBtn").addEventListener("click", () => startRender(true));
$("exportBtn").addEventListener("click", () => startRender(false));

if (!tauriInvoke) {
  printStatus("Tauri invoke bridge not found.");
}

async function initEncoderOptions() {
  try {
    const options = await invoke("get_encoder_options");
    const available = new Set(options);

    for (const opt of encoder.querySelectorAll("option")) {
      const v = opt.value;
      if (v === "auto" || v === "cpu") {
        opt.disabled = false;
        continue;
      }
      opt.disabled = !available.has(v);
      if (opt.disabled && !opt.textContent.includes("(unavailable)")) {
        opt.textContent += " (unavailable)";
      }
    }

    if (encoder.value !== "auto" && encoder.value !== "cpu" && !available.has(encoder.value)) {
      encoder.value = "auto";
      saveSettings();
    }

    if (available.has("nvidia")) {
      printStatus("Encoder: Auto will use NVIDIA NVENC");
    } else if (available.has("intel")) {
      printStatus("Encoder: Auto will use Intel QSV");
    } else if (available.has("amd")) {
      printStatus("Encoder: Auto will use AMD AMF");
    } else {
      printStatus("Encoder: Auto will use CPU (libx264)");
    }
  } catch (e) {
    printStatus(`Encoder detection failed: ${String(e)}`);
  }
}

async function applyIncomingReframedInput() {
  try {
    const params = new URLSearchParams(window.location.search);
    const incoming = params.get("reframed");
    if (!incoming) return;

    videoPath.value = incoming;
    await invoke("open_video", { path: incoming });
    outputPath.value = buildDefaultOutputPath(incoming);
    printStatus("Reframed video loaded from Reframe workspace.");
    await refreshProject();
  } catch (e) {
    printStatus(String(e));
  }
}

initEncoderOptions().catch(() => {});
refreshProject().catch((e) => {
  if (!tauriInvoke) return;
  printStatus(String(e));
});
applyIncomingReframedInput().catch(() => {});
