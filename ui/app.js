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

const LEGACY_SETTINGS_KEY = "naVShorts.effects.v1";
const SETTINGS_KEY = "naVShorts.motion.v1";
const CINE_SETTINGS_KEY = "naVShorts.cineMotion.v1";
const RESET_NOTICE_KEY = "naVShorts.resetNotice.v1";
const appConfig = {
  defaultEffectsZoomMode: "zoomSineSmooth",
};
const DEFAULT_MOTION_MODE = "quickEffects";
const CINE_DEFAULTS = {
  zoomSoftStrength: 1.05,
  zoomStrongStrength: 1.08,
  zoomAttackSec: 0.14,
  zoomReleaseSec: 1.00,
  panOffset: 0.05,
  panAttackSec: 0.14,
  panReleaseSec: 1.10,
  cursorFocusStrength: 1.06,
  cursorFocusAttackSec: 0.15,
  cursorFocusReleaseSec: 1.05,
  easing: "easeOutCubic",
};

const videoPath = $("videoPath");
const outputPath = $("outputPath");
const projectInfo = $("projectInfo");
const cineJsonInfo = $("cineJsonInfo");
const statusInfo = $("statusInfo");
const renderProgress = $("renderProgress");
const etaInfo = $("etaInfo");
const quickProjectSection = $("quickProjectSection");
const cineEventSection = $("cineEventSection");

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
const motionModeButtons = Array.from(document.querySelectorAll("[data-motion-mode]"));
const cineMotionPanel = $("cineMotionPanel");
const quickEffectsPanel = $("quickEffectsPanel");
const cineVideoPath = $("cineVideoPath");
const cineOutputPath = $("cineOutputPath");
const cinePreset = $("cinePreset");
const cineEncoder = $("cineEncoder");
const cineVideo = $("cineVideo");
const cineMeta = $("cineMeta");
const cinePlaybackRate = $("cinePlaybackRate");
const cineEventList = $("cineEventList");
let currentMotionMode = DEFAULT_MOTION_MODE;
let cineVideoInfo = null;
let cineEvents = [];
let cinePreviewPath = "";
let cineBlobUrl = "";
let cineHoverPoint = { x: 0.5, y: 0.5 };

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

function printCineJson() {
  if (!cineJsonInfo) return;
  cineJsonInfo.textContent = JSON.stringify(cineEvents, null, 2);
}

function secondsLabel(sec) {
  const total = Math.max(0, Number(sec) || 0);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total - Math.floor(total)) * 100);
  return `${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
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
    const raw = localStorage.getItem(SETTINGS_KEY) || localStorage.getItem(LEGACY_SETTINGS_KEY);
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
    const raw = localStorage.getItem(SETTINGS_KEY) || localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (typeof s.motionMode === "string") currentMotionMode = s.motionMode;
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
    motionMode: currentMotionMode,
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

function loadCineSettings() {
  try {
    const raw = localStorage.getItem(CINE_SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (typeof s.videoPath === "string") cineVideoPath.value = s.videoPath;
    if (typeof s.outputPath === "string") cineOutputPath.value = s.outputPath;
    if (typeof s.preset === "string") cinePreset.value = s.preset;
    if (typeof s.encoder === "string") cineEncoder.value = s.encoder;
    if (typeof s.playbackRate === "string") cinePlaybackRate.value = s.playbackRate;
    if (Array.isArray(s.events)) cineEvents = s.events;
  } catch {
    // ignore broken cine motion settings
  }
}

function saveCineSettings() {
  const payload = {
    videoPath: cineVideoPath.value,
    outputPath: cineOutputPath.value,
    preset: cinePreset.value,
    encoder: cineEncoder.value,
    playbackRate: cinePlaybackRate.value,
    events: cineEvents,
  };
  localStorage.setItem(CINE_SETTINGS_KEY, JSON.stringify(payload));
}

function sortCineEvents() {
  cineEvents.sort((a, b) => Number(a.timeSec || 0) - Number(b.timeSec || 0));
}

function renderCineEventList() {
  if (!cineEventList) return;
  cineEventList.innerHTML = "";
  sortCineEvents();
  if (!cineEvents.length) {
    cineEventList.innerHTML = '<div class="assistHelp">No Cine Motion events yet.</div>';
    printCineJson();
    saveCineSettings();
    return;
  }

  cineEvents.forEach((event, index) => {
    const item = document.createElement("div");
    item.className = "anchorItem motionEventItem";

    const info = document.createElement("div");
    info.className = "motionEventInfo";
    const summary = document.createElement("div");
    summary.className = "motionEventSummary";
    summary.textContent = `#${index + 1} ${secondsLabel(event.timeSec)} | ${event.type}`;
    info.appendChild(summary);

    const controls = document.createElement("div");
    controls.className = "motionEventControls";

    const strengthInput = document.createElement("input");
    strengthInput.type = "number";
    strengthInput.min = "1.00";
    strengthInput.max = "1.10";
    strengthInput.step = "0.01";
    strengthInput.value = Number(event.strength || 1.0).toFixed(2);
    strengthInput.title = "Strength";
    strengthInput.addEventListener("change", () => {
      event.strength = Math.min(1.10, Math.max(1.0, Number(strengthInput.value) || 1.0));
      renderCineEventList();
    });

    const attackInput = document.createElement("input");
    attackInput.type = "number";
    attackInput.min = "0.03";
    attackInput.max = "1.00";
    attackInput.step = "0.01";
    attackInput.value = Number(event.attackSec || 0.15).toFixed(2);
    attackInput.title = "Attack sec";
    attackInput.addEventListener("change", () => {
      event.attackSec = Math.min(1.0, Math.max(0.03, Number(attackInput.value) || 0.15));
      renderCineEventList();
    });

    const releaseInput = document.createElement("input");
    releaseInput.type = "number";
    releaseInput.min = "0.10";
    releaseInput.max = "4.00";
    releaseInput.step = "0.05";
    releaseInput.value = Number(event.releaseSec || 1.0).toFixed(2);
    releaseInput.title = "Release sec";
    releaseInput.addEventListener("change", () => {
      event.releaseSec = Math.min(4.0, Math.max(0.10, Number(releaseInput.value) || 1.0));
      renderCineEventList();
    });

    const easingSelect = document.createElement("select");
    easingSelect.innerHTML = `
      <option value="easeOutCubic">easeOutCubic</option>
      <option value="easeOutQuart">easeOutQuart</option>
    `;
    easingSelect.value = event.easing || "easeOutCubic";
    easingSelect.addEventListener("change", () => {
      event.easing = easingSelect.value;
      renderCineEventList();
    });

    controls.appendChild(strengthInput);
    controls.appendChild(attackInput);
    controls.appendChild(releaseInput);
    controls.appendChild(easingSelect);

    if (event.type === "pan" || event.type === "cursorFocus") {
      const offsetLabel = document.createElement("div");
      offsetLabel.className = "motionEventOffset";
      offsetLabel.textContent = `x ${(Number(event.offsetX || 0) * 100).toFixed(1)}% / y ${(Number(event.offsetY || 0) * 100).toFixed(1)}%`;
      info.appendChild(offsetLabel);
    }

    const actions = document.createElement("div");
    actions.className = "anchorActions";
    const jumpBtn = document.createElement("button");
    jumpBtn.className = "secondary";
    jumpBtn.textContent = "Jump";
    jumpBtn.addEventListener("click", () => {
      if (!cineVideo.src) return;
      cineVideo.currentTime = Number(event.timeSec || 0);
      cineVideo.pause();
    });
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      cineEvents.splice(index, 1);
      renderCineEventList();
      printStatus("Cine Motion event deleted.");
    });
    actions.appendChild(jumpBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(info);
    item.appendChild(controls);
    item.appendChild(actions);
    cineEventList.appendChild(item);
  });

  printCineJson();
  saveCineSettings();
}

function applyMotionMode(mode, { persist = true, keepStatus = false } = {}) {
  currentMotionMode = mode === "cineMotion" ? "cineMotion" : "quickEffects";

  for (const btn of motionModeButtons) {
    const active = btn.dataset.motionMode === currentMotionMode;
    btn.classList.toggle("motionModeBtnActive", active);
    btn.classList.toggle("motionModeBtnInactive", !active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  }

  cineMotionPanel.hidden = currentMotionMode !== "cineMotion";
  quickEffectsPanel.hidden = currentMotionMode !== "quickEffects";
  if (cineEventSection) cineEventSection.hidden = currentMotionMode !== "cineMotion";
  if (quickProjectSection) quickProjectSection.hidden = currentMotionMode !== "quickEffects";

  if (persist) saveSettings();

  if (!keepStatus && currentMotionMode === "cineMotion") {
    if (!cineVideo.src && cineVideoPath.value.trim()) {
      loadCineVideo(cineVideoPath.value.trim(), { silent: true }).catch((e) => printStatus(String(e)));
    }
    renderCineEventList();
    printStatus("Cine Motion workspace ready. Play the preview and record zoom / pan / cursor-focus events with the keyboard.");
    setProgress(0, "Cine Motion");
  } else if (!keepStatus && currentMotionMode === "quickEffects") {
    printStatus("Quick Effects workspace ready.");
    setProgress(renderProgress.value || 0, etaInfo.textContent || "Idle");
  }
}

loadSettings();
loadCineSettings();
loadAppConfigDefaults().then(() => {
  applyMotionMode(currentMotionMode, { persist: false, keepStatus: true });
  saveSettings();
  renderCineEventList();
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
motionModeButtons.forEach((btn) => {
  btn.addEventListener("click", () => applyMotionMode(btn.dataset.motionMode, { persist: true }));
});
[cinePreset, cineEncoder, cinePlaybackRate].forEach((el) => el?.addEventListener("change", () => {
  if (el === cinePlaybackRate && cineVideo) {
    cineVideo.playbackRate = Number(cinePlaybackRate.value || 1);
  }
  saveCineSettings();
}));

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
    cineVideoPath.value = picked;
    if (!cineOutputPath.value.trim()) {
      cineOutputPath.value = buildCineOutputPath(picked);
    }
    saveCineSettings();

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
$("cineOpenBtn").addEventListener("click", async () => {
  try {
    const picked = await invoke("pick_video_file");
    if (!picked) {
      printStatus("Video selection cancelled.");
      return;
    }
    await loadCineVideo(picked);
  } catch (e) {
    printStatus(String(e));
  }
});
$("cinePlayPauseBtn").addEventListener("click", async () => {
  if (!cineVideo.src) {
    printStatus("Load a video before playing Cine Motion preview.");
    return;
  }
  if (cineVideo.paused) {
    await cineVideo.play().catch((e) => {
      throw new Error(String(e));
    });
  } else {
    cineVideo.pause();
  }
});
$("cineUndoBtn").addEventListener("click", undoLastCineEvent);
$("cineSortEventsBtn").addEventListener("click", () => {
  renderCineEventList();
  printStatus("Cine Motion events sorted.");
});
$("cineClearEventsBtn").addEventListener("click", () => {
  cineEvents = [];
  renderCineEventList();
  printStatus("Cine Motion events cleared.");
});
$("cinePreviewBtn").addEventListener("click", () => startCineRender(true));
$("cineExportBtn").addEventListener("click", () => startCineRender(false));

if (!tauriInvoke) {
  printStatus("Tauri invoke bridge not found.");
}

async function initEncoderOptions() {
  try {
    const options = await invoke("get_encoder_options");
    const available = new Set(options);

    for (const selectEl of [encoder, cineEncoder]) {
      for (const opt of selectEl.querySelectorAll("option")) {
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
    }

    if (encoder.value !== "auto" && encoder.value !== "cpu" && !available.has(encoder.value)) {
      encoder.value = "auto";
      saveSettings();
    }
    if (cineEncoder.value !== "auto" && cineEncoder.value !== "cpu" && !available.has(cineEncoder.value)) {
      cineEncoder.value = "auto";
      saveCineSettings();
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
    cineVideoPath.value = incoming;
    if (!cineOutputPath.value.trim()) {
      cineOutputPath.value = buildCineOutputPath(incoming);
    }
    saveCineSettings();
    printStatus("Reframed video loaded from Reframe workspace.");
    await refreshProject();
    if (currentMotionMode === "cineMotion") {
      await loadCineVideo(incoming, { silent: true });
      printStatus("Reframed video loaded into Cine Motion.");
    }
  } catch (e) {
    printStatus(String(e));
  }
}

async function loadPreviewBlobUrl(previewPath) {
  const payload = await invoke("read_preview_video_base64", { path: previewPath });
  const binary = atob(payload.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: "video/mp4" });
  return URL.createObjectURL(blob);
}

async function loadCineVideo(path, { silent = false } = {}) {
  if (!path) return;
  const info = await invoke("open_video", { path });
  cineVideoInfo = info;
  cineVideoPath.value = path;
  if (!cineOutputPath.value.trim()) {
    cineOutputPath.value = buildCineOutputPath(path);
  }
  cinePreviewPath = await invoke("create_preview_video_with_audio", { path });
  if (cineBlobUrl) {
    try { URL.revokeObjectURL(cineBlobUrl); } catch {}
  }
  cineBlobUrl = await loadPreviewBlobUrl(cinePreviewPath);
  cineVideo.pause();
  cineVideo.src = cineBlobUrl;
  cineVideo.load();
  cineVideo.playbackRate = Number(cinePlaybackRate.value || 1);
  cineMeta.textContent = `Video ${info.width}x${info.height} | ${info.fps.toFixed(2)} fps | duration ${info.duration_sec.toFixed(2)} sec | events ${cineEvents.length}`;
  saveCineSettings();
  if (!silent) {
    printStatus("Source video loaded for Cine Motion.");
  }
}

function cineCurrentTime() {
  return Number.isFinite(cineVideo.currentTime) ? Number(cineVideo.currentTime.toFixed(3)) : 0;
}

function createCineEvent(type, patch = {}) {
  return {
    timeSec: cineCurrentTime(),
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
}

function recordCineEvent(event) {
  if (!cineVideo.src) {
    printStatus("Load a video before recording Cine Motion events.");
    return;
  }
  cineEvents.push(event);
  renderCineEventList();
  cineMeta.textContent = `Video ${cineVideoInfo?.width || 0}x${cineVideoInfo?.height || 0} | ${cineVideoInfo?.fps?.toFixed?.(2) || "0.00"} fps | duration ${cineVideoInfo?.duration_sec?.toFixed?.(2) || "0.00"} sec | events ${cineEvents.length}`;
  printStatus(`Recorded ${event.type} event at ${secondsLabel(event.timeSec)}.`);
}

function stepCine(seconds) {
  if (!cineVideo.src || !Number.isFinite(seconds)) return;
  const duration = Number.isFinite(cineVideo.duration) ? cineVideo.duration : Number(cineVideoInfo?.duration_sec || 0);
  const maxTime = Math.max(0, duration - 0.001);
  cineVideo.currentTime = Math.min(Math.max((cineVideo.currentTime || 0) + seconds, 0), maxTime);
}

function undoLastCineEvent() {
  if (!cineEvents.length) {
    printStatus("No Cine Motion event to undo.");
    return;
  }
  const removed = cineEvents.pop();
  renderCineEventList();
  printStatus(`Removed last Cine Motion event (${removed?.type || "event"}).`);
}

async function startCineRender(preview) {
  try {
    if (!cineVideoPath.value.trim()) {
      throw new Error("Load a video before rendering Cine Motion.");
    }
    if (!cineEvents.length) {
      throw new Error("Add at least one Cine Motion event before rendering.");
    }
    if (!cineOutputPath.value.trim()) {
      cineOutputPath.value = buildCineOutputPath(cineVideoPath.value.trim());
    }
    saveCineSettings();
    const finalOutputPath = preview
      ? buildPreviewOutputPath(cineOutputPath.value.trim(), cineVideoPath.value.trim())
      : cineOutputPath.value.trim();
    const jobId = await invoke("render_cine_motion", {
      request: {
        inputPath: cineVideoPath.value.trim(),
        outputPath: finalOutputPath,
        preset: cinePreset.value,
        preview,
        encoder: cineEncoder.value,
        events: cineEvents,
      },
    });

    const startedAt = Date.now();
    setProgress(0, preview ? "Starting Cine preview..." : "Starting Cine export...");
    printStatus({ jobId, state: "queued", outputPath: finalOutputPath, mode: "cineMotion" });

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
          setProgress(1, preview ? "Cine preview completed" : "Cine Motion completed");
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

cineVideo.addEventListener("loadedmetadata", () => {
  cineMeta.textContent = `Video ${cineVideo.videoWidth || cineVideoInfo?.width || 0}x${cineVideo.videoHeight || cineVideoInfo?.height || 0} | ${cineVideoInfo?.fps?.toFixed?.(2) || "0.00"} fps | duration ${Number(cineVideo.duration || cineVideoInfo?.duration_sec || 0).toFixed(2)} sec | events ${cineEvents.length}`;
});

cineVideo.addEventListener("mousemove", (event) => {
  const rect = cineVideo.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  cineHoverPoint = {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
});

function shouldIgnoreCineShortcut(target) {
  if (!target) return false;
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName);
}

function handleCineShortcutKeydown(event) {
  if (currentMotionMode !== "cineMotion") return;
  if (shouldIgnoreCineShortcut(event.target)) return;

  const key = event.key;
  if (event.ctrlKey && key.toLowerCase() === "z") {
    event.preventDefault();
    undoLastCineEvent();
    return;
  }

  if (key === " ") {
    event.preventDefault();
    $("cinePlayPauseBtn").click();
    return;
  }
  if (key === "ArrowLeft") {
    event.preventDefault();
    stepCine(-5);
    return;
  }
  if (key === "ArrowRight") {
    event.preventDefault();
    stepCine(5);
    return;
  }

  if (!cineVideo.src) return;

  switch (key.toLowerCase()) {
    case "z":
      event.preventDefault();
      recordCineEvent(createCineEvent("zoom", {
        strength: CINE_DEFAULTS.zoomSoftStrength,
        attackSec: CINE_DEFAULTS.zoomAttackSec,
        releaseSec: CINE_DEFAULTS.zoomReleaseSec,
      }));
      break;
    case "x":
      event.preventDefault();
      recordCineEvent(createCineEvent("zoom", {
        strength: CINE_DEFAULTS.zoomStrongStrength,
        attackSec: CINE_DEFAULTS.zoomAttackSec,
        releaseSec: CINE_DEFAULTS.zoomReleaseSec,
      }));
      break;
    case "v":
      event.preventDefault();
      recordCineEvent(createCineEvent("pan", {
        strength: 1.0,
        offsetX: -CINE_DEFAULTS.panOffset,
        attackSec: CINE_DEFAULTS.panAttackSec,
        releaseSec: CINE_DEFAULTS.panReleaseSec,
      }));
      break;
    case "b":
      event.preventDefault();
      recordCineEvent(createCineEvent("pan", {
        strength: 1.0,
        offsetX: CINE_DEFAULTS.panOffset,
        attackSec: CINE_DEFAULTS.panAttackSec,
        releaseSec: CINE_DEFAULTS.panReleaseSec,
      }));
      break;
    case "n":
      event.preventDefault();
      recordCineEvent(createCineEvent("pan", {
        strength: 1.0,
        offsetY: -CINE_DEFAULTS.panOffset,
        attackSec: CINE_DEFAULTS.panAttackSec,
        releaseSec: CINE_DEFAULTS.panReleaseSec,
      }));
      break;
    case "m":
      event.preventDefault();
      recordCineEvent(createCineEvent("pan", {
        strength: 1.0,
        offsetY: CINE_DEFAULTS.panOffset,
        attackSec: CINE_DEFAULTS.panAttackSec,
        releaseSec: CINE_DEFAULTS.panReleaseSec,
      }));
      break;
    case "c":
      event.preventDefault();
      recordCineEvent(createCineEvent("cursorFocus", {
        strength: CINE_DEFAULTS.cursorFocusStrength,
        attackSec: CINE_DEFAULTS.cursorFocusAttackSec,
        releaseSec: CINE_DEFAULTS.cursorFocusReleaseSec,
        focusXRatio: cineHoverPoint.x,
        focusYRatio: cineHoverPoint.y,
      }));
      break;
    default:
      break;
  }
}

window.addEventListener("keydown", handleCineShortcutKeydown, true);

initEncoderOptions().catch(() => {});
refreshProject().catch((e) => {
  if (!tauriInvoke) return;
  printStatus(String(e));
});
applyIncomingReframedInput().catch(() => {});
