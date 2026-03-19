function resolveInvoke() {
  const modern = window.__TAURI__?.core?.invoke;
  if (typeof modern === "function") return modern;
  const legacy = window.__TAURI__?.tauri?.invoke;
  if (typeof legacy === "function") return legacy;
  const internal = window.__TAURI_INTERNALS__?.invoke;
  if (typeof internal === "function") return (cmd, payload) => internal(cmd, payload);
  return null;
}

function resolveConvertFileSrc() {
  const modern = window.__TAURI__?.core?.convertFileSrc;
  if (typeof modern === "function") return modern;
  const legacy = window.__TAURI__?.tauri?.convertFileSrc;
  if (typeof legacy === "function") return legacy;
  const internal = window.__TAURI_INTERNALS__?.convertFileSrc;
  if (typeof internal === "function") return internal;
  return null;
}

const tauriInvoke = resolveInvoke();
const convertFileSrc = resolveConvertFileSrc();
const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = "naVShorts.reframeAssist.v5";
const RESET_NOTICE_KEY = "naVShorts.resetNotice.v1";
const DEFAULT_FACE_FOLDER = "S:\\tools\\codex\\waka_images";
const appConfig = {
  targetFaceFolder: DEFAULT_FACE_FOLDER,
  assistJsonDir: "",
  previewProxyDir: "",
  configPath: "",
  defaultAssistTrackingEngine: "yoloBytetrackArcface",
};

const sourceVideoPath = $("sourceVideoPath");
const assistJsonPath = $("assistJsonPath");
const targetFacePath = $("targetFacePath");
const pickTargetFaceBtn = $("pickTargetFaceBtn");
const assistTrackingEngine = $("assistTrackingEngine");
const stability = $("stability");
const stabilityValue = $("stabilityValue");
const playbackRate = $("playbackRate");
const showAllAnchors = $("showAllAnchors");
const assistVideo = $("assistVideo");
const assistOverlay = $("assistOverlay");
const assistMeta = $("assistMeta");
const statusInfo = $("statusInfo");
const anchorList = $("anchorList");
const anchorJson = $("anchorJson");
const renderProgress = $("renderProgress");
const etaInfo = $("etaInfo");

let videoInfo = null;
let anchors = [];
let dragRect = null;
let dragStart = null;
let lastPreviewPath = "";
let lastVideoSrc = "";
let lastBlobUrl = "";
let mediaDiagnostics = {
  message: "Idle",
  tauriAvailable: Boolean(tauriInvoke),
  convertFileSrcAvailable: Boolean(convertFileSrc),
  previewPath: "",
  videoSrc: "",
  html5: {},
  element: {},
  previewInspect: null,
  events: [],
};

function cloneDiag() {
  return JSON.parse(JSON.stringify(mediaDiagnostics));
}

function trimEvents() {
  if (mediaDiagnostics.events.length > 30) {
    mediaDiagnostics.events = mediaDiagnostics.events.slice(mediaDiagnostics.events.length - 30);
  }
}

function canPlaySnapshot() {
  return {
    mp4: assistVideo.canPlayType("video/mp4"),
    mp4Baseline: assistVideo.canPlayType('video/mp4; codecs="avc1.42E01E"'),
    mp4Main: assistVideo.canPlayType('video/mp4; codecs="avc1.4D401E"'),
    h264Aac: assistVideo.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),
  };
}

function elementSnapshot() {
  const err = assistVideo.error;
  return {
    currentSrc: assistVideo.currentSrc || "",
    src: assistVideo.src || "",
    readyState: assistVideo.readyState,
    networkState: assistVideo.networkState,
    paused: assistVideo.paused,
    ended: assistVideo.ended,
    duration: Number.isFinite(assistVideo.duration) ? assistVideo.duration : null,
    currentTime: Number.isFinite(assistVideo.currentTime) ? assistVideo.currentTime : null,
    videoWidth: assistVideo.videoWidth || 0,
    videoHeight: assistVideo.videoHeight || 0,
    playbackRate: assistVideo.playbackRate,
    error: err ? { code: err.code, message: err.message || "" } : null,
  };
}

function updateDiagnostics(patch = {}, print = true) {
  mediaDiagnostics = {
    ...mediaDiagnostics,
    ...patch,
    previewPath: lastPreviewPath,
    videoSrc: lastVideoSrc,
    html5: canPlaySnapshot(),
    element: elementSnapshot(),
  };
  trimEvents();
  if (print) {
    statusInfo.textContent = JSON.stringify(cloneDiag(), null, 2);
  }
}

function pushVideoEvent(name, extra = {}) {
  mediaDiagnostics.events.push({ at: new Date().toISOString(), event: name, ...extra });
  trimEvents();
  updateDiagnostics({}, true);
}

function printStatus(textOrObject) {
  const patch = typeof textOrObject === "string" ? { message: textOrObject } : textOrObject;
  updateDiagnostics(patch, true);
}

function setProgress(progress, etaText) {
  renderProgress.value = Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0;
  etaInfo.textContent = etaText;
}

function updateOverlayInteractivity() {
  const canDraw = Boolean(videoInfo) && assistVideo.paused;
  assistOverlay.style.pointerEvents = canDraw ? "auto" : "none";
  assistOverlay.style.cursor = canDraw ? "crosshair" : "default";
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function timestampYYMMDDhhmmss(d = new Date()) {
  return `${pad2(d.getFullYear() % 100)}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

function directoryOf(pathValue) {
  const normalized = (pathValue || "").replace(/\//g, "\\");
  const lastSlash = normalized.lastIndexOf("\\");
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : "";
}

function buildJsonPath(inputFullPath) {
  const normalized = inputFullPath.replace(/\//g, "\\");
  const lastSlash = normalized.lastIndexOf("\\");
  const configuredDir = (appConfig.assistJsonDir || "").trim();
  const baseDir = configuredDir ? configuredDir.replace(/\//g, "\\") : (lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : "");
  const dir = baseDir.endsWith("\\") ? baseDir : (baseDir ? `${baseDir}\\` : "");
  const file = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  const dot = file.lastIndexOf(".");
  const base = dot > 0 ? file.slice(0, dot) : file;
  return `${dir}${base}_assist_${timestampYYMMDDhhmmss()}.json`;
}

function bindSlider(inputEl, labelEl) {
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

function saveSettings() {
  const payload = {
    stability: Number(stability.value),
    playbackRate: playbackRate.value,
    targetFacePath: targetFacePath?.value || DEFAULT_FACE_FOLDER,
    assistTrackingEngine: assistTrackingEngine?.value || "yoloBytetrackArcface",
    showAllAnchors: Boolean(showAllAnchors?.checked),
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
}

function loadSettings() {
  if (targetFacePath && !targetFacePath.value) targetFacePath.value = DEFAULT_FACE_FOLDER;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (typeof s.stability === "number") stability.value = String(s.stability);
    if (typeof s.playbackRate === "string") playbackRate.value = s.playbackRate;
    if (targetFacePath) targetFacePath.value = typeof s.targetFacePath === "string" && s.targetFacePath.trim() ? s.targetFacePath : DEFAULT_FACE_FOLDER;
    if (assistTrackingEngine && typeof s.assistTrackingEngine === "string") assistTrackingEngine.value = s.assistTrackingEngine;
    if (showAllAnchors) showAllAnchors.checked = Boolean(s.showAllAnchors);
  } catch {
    // ignore
  }
}

async function loadAppConfigDefaults() {
  try {
    const cfg = await invoke("get_app_config");
    appConfig.targetFaceFolder = cfg.targetFaceFolder || DEFAULT_FACE_FOLDER;
    appConfig.assistJsonDir = cfg.assistJsonDir || "";
    appConfig.previewProxyDir = cfg.previewProxyDir || "";
    appConfig.configPath = cfg.configPath || "";
    appConfig.defaultAssistTrackingEngine = cfg.preReframeDefaultEngine || "yoloBytetrackArcface";
    const raw = localStorage.getItem(SETTINGS_KEY);
    let saved = null;
    try { saved = raw ? JSON.parse(raw) : null; } catch {}
    if (!saved || typeof saved.assistTrackingEngine !== "string") {
      assistTrackingEngine.value = appConfig.defaultAssistTrackingEngine || "yoloBytetrackArcface";
    }
    if (targetFacePath && (!targetFacePath.value.trim() || targetFacePath.value.trim() === DEFAULT_FACE_FOLDER)) {
      targetFacePath.value = appConfig.targetFaceFolder || DEFAULT_FACE_FOLDER;
    }
    if (sourceVideoPath.value.trim() && !assistJsonPath.value.trim()) {
      assistJsonPath.value = buildJsonPath(sourceVideoPath.value.trim());
    }
  } catch {
    // ignore config load failures
  }
}

async function invoke(cmd, payload) {
  if (!tauriInvoke) throw new Error("Tauri API not available");
  return tauriInvoke(cmd, payload);
}

function toVideoSrc(path) {
  const normalized = path.replace(/\\/g, "/");
  if (convertFileSrc) {
    try {
      return convertFileSrc(normalized);
    } catch (error) {
      pushVideoEvent("convertFileSrcFailed", { message: String(error) });
    }
  }
  return normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
}

function secondsLabel(sec) {
  const total = Math.max(0, sec || 0);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total - Math.floor(total)) * 100);
  return `${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
}

function syncOverlaySize() {
  const width = Math.round(assistVideo.clientWidth || assistVideo.getBoundingClientRect().width || 0);
  const height = Math.round(assistVideo.clientHeight || assistVideo.getBoundingClientRect().height || 0);
  if (width <= 0 || height <= 0) return;
  assistOverlay.width = width;
  assistOverlay.height = height;
  assistOverlay.style.width = `${width}px`;
  assistOverlay.style.height = `${height}px`;
  redrawOverlay();
}

function interpolateAnchorValue(a, b, key, u) {
  return (a[key] + (b[key] - a[key]) * u);
}

function getDisplayRectAtTime(timeSec) {
  if (anchors.length === 0) return null;
  const sorted = anchors;
  if (sorted.length === 1) return sorted[0];
  if (timeSec <= sorted[0].timeSec) return sorted[0];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
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
  return sorted[sorted.length - 1];
}

function drawRect(anchor, stroke, fill, lineWidth = 2) {
  if (!anchor) return;
  const ctx = assistOverlay.getContext("2d");
  const x = anchor.rectXRatio * assistOverlay.width;
  const y = anchor.rectYRatio * assistOverlay.height;
  const w = anchor.rectWRatio * assistOverlay.width;
  const h = anchor.rectHRatio * assistOverlay.height;
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;
  ctx.strokeRect(x, y, w, h);
  if (fill) ctx.fillRect(x, y, w, h);
}

function redrawOverlay() {
  const ctx = assistOverlay.getContext("2d");
  ctx.clearRect(0, 0, assistOverlay.width, assistOverlay.height);

  if (showAllAnchors?.checked) {
    for (const anchor of anchors) {
      drawRect(anchor, "rgba(217,79,48,0.55)", "rgba(217,79,48,0.08)", 1.5);
    }
  }

  const displayRect = getDisplayRectAtTime(Number(assistVideo.currentTime || 0));
  drawRect(displayRect, "rgba(31,107,140,0.98)", "rgba(31,107,140,0.14)", 2.5);

  if (dragRect) {
    const previewAnchor = {
      rectXRatio: dragRect.x / assistOverlay.width,
      rectYRatio: dragRect.y / assistOverlay.height,
      rectWRatio: dragRect.w / assistOverlay.width,
      rectHRatio: dragRect.h / assistOverlay.height,
    };
    drawRect(previewAnchor, "rgba(217,79,48,0.98)", "rgba(217,79,48,0.18)", 2);
  }
}

function renderAnchors() {
  anchorJson.textContent = JSON.stringify({
    sourceVideo: sourceVideoPath.value.trim() || null,
    targetFacePath: targetFacePath?.value?.trim() || null,
    assistTrackingEngine: assistTrackingEngine?.value || "yoloBytetrackArcface",
    anchors,
  }, null, 2);
  anchorList.innerHTML = "";
  if (anchors.length === 0) {
    anchorList.textContent = "No anchors yet.";
    redrawOverlay();
    return;
  }
  anchors.forEach((anchor, idx) => {
    const row = document.createElement("div");
    row.className = "anchorItem";
    row.innerHTML = `<div><strong>#${idx + 1}</strong> ${secondsLabel(anchor.timeSec)} | x ${(anchor.centerXRatio * 100).toFixed(1)}%</div>`;

    const jumpBtn = document.createElement("button");
    jumpBtn.className = "secondary";
    jumpBtn.textContent = "Jump";
    jumpBtn.addEventListener("click", () => {
      assistVideo.currentTime = anchor.timeSec;
      assistVideo.pause();
      redrawOverlay();
    });

    const delBtn = document.createElement("button");
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => {
      anchors = anchors.filter((_, i) => i !== idx);
      renderAnchors();
      updateMeta();
    });

    const actions = document.createElement("div");
    actions.className = "anchorActions";
    actions.appendChild(jumpBtn);
    actions.appendChild(delBtn);
    row.appendChild(actions);
    anchorList.appendChild(row);
  });
  redrawOverlay();
}

function getCanvasPoint(ev) {
  const x = Number.isFinite(ev.offsetX) ? ev.offsetX : 0;
  const y = Number.isFinite(ev.offsetY) ? ev.offsetY : 0;
  return {
    x: Math.min(Math.max(x, 0), assistOverlay.width),
    y: Math.min(Math.max(y, 0), assistOverlay.height),
  };
}

function normalizeRect(rect) {
  const x = Math.min(rect.x, rect.x + rect.w);
  const y = Math.min(rect.y, rect.y + rect.h);
  const w = Math.abs(rect.w);
  const h = Math.abs(rect.h);
  return { x, y, w, h };
}

function addAnchorFromRect(rect) {
  if (!videoInfo || assistOverlay.width <= 0 || assistOverlay.height <= 0) return;
  const norm = normalizeRect(rect);
  if (norm.w < 12 || norm.h < 12) {
    printStatus("Selection too small. Draw a larger face rectangle.");
    return;
  }

  const anchor = {
    timeSec: Number(assistVideo.currentTime.toFixed(3)),
    centerXRatio: (norm.x + norm.w * 0.5) / assistOverlay.width,
    rectXRatio: norm.x / assistOverlay.width,
    rectYRatio: norm.y / assistOverlay.height,
    rectWRatio: norm.w / assistOverlay.width,
    rectHRatio: norm.h / assistOverlay.height,
  };
  anchors.push(anchor);
  anchors.sort((a, b) => a.timeSec - b.timeSec);
  renderAnchors();
  updateMeta();
  printStatus({ message: `Anchor saved at ${secondsLabel(anchor.timeSec)} | center ${(anchor.centerXRatio * 100).toFixed(1)}%` });
}

function updateMeta() {
  if (!videoInfo) {
    assistMeta.textContent = "No video loaded.";
    updateOverlayInteractivity();
    return;
  }
  assistMeta.textContent = `Video ${videoInfo.width}x${videoInfo.height} | ${videoInfo.fps.toFixed(2)} fps | duration ${secondsLabel(videoInfo.durationSec)} | anchors ${anchors.length}`;
  updateOverlayInteractivity();
}

async function saveAssistJson() {
  try {
    const path = assistJsonPath.value.trim();
    if (!sourceVideoPath.value.trim()) {
      printStatus("Source video path is empty.");
      return;
    }
    if (!path) {
      printStatus("Assist JSON path is empty.");
      return;
    }
    if (anchors.length < 2) {
      printStatus("Add at least 2 anchors before saving Assist JSON.");
      return;
    }
    const result = await invoke("save_manual_assist_json", {
      path,
      sourceVideo: sourceVideoPath.value.trim(),
      targetFacePath: targetFacePath?.value?.trim() || null,
      assistTrackingEngine: assistTrackingEngine?.value || "yoloBytetrackArcface",
      anchors: anchors.map((a) => ({
        timeSec: a.timeSec,
        centerXRatio: a.centerXRatio,
        rectXRatio: a.rectXRatio,
        rectYRatio: a.rectYRatio,
        rectWRatio: a.rectWRatio,
        rectHRatio: a.rectHRatio,
      })),
    });
    anchorJson.textContent = JSON.stringify(result, null, 2);
    printStatus({ message: `Assist JSON saved. anchors=${result.anchors?.length || anchors.length}` });
  } catch (e) {
    printStatus(String(e));
  }
}

async function attachPreviewForSource(sourcePath) {
  mediaDiagnostics.previewInspect = null;
  mediaDiagnostics.events = [];
  printStatus({ message: "Creating preview proxy..." });

  const previewPath = await invoke("create_preview_video", { path: sourcePath });
  lastPreviewPath = previewPath;
  lastVideoSrc = toVideoSrc(previewPath);

  try {
    const inspect = await invoke("inspect_preview_video", { path: previewPath });
    mediaDiagnostics.previewInspect = inspect;
  } catch (error) {
    mediaDiagnostics.previewInspect = { inspectError: String(error) };
  }

  assistVideo.pause();
  assistVideo.removeAttribute("src");
  assistVideo.load();

  if (lastBlobUrl) {
    URL.revokeObjectURL(lastBlobUrl);
    lastBlobUrl = "";
  }

  let assignedSrc = lastVideoSrc;
  try {
    const response = await fetch(lastVideoSrc);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(new Blob([blob], { type: "video/mp4" }));
    lastBlobUrl = blobUrl;
    assignedSrc = blobUrl;
    mediaDiagnostics.fetch = {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type"),
      blobSize: blob.size,
      mode: "blob-url-fetch",
    };
  } catch (error) {
    mediaDiagnostics.fetch = { error: String(error), mode: "asset-url-fallback" };
    try {
      const base64Payload = await invoke("read_preview_video_base64", { path: previewPath });
      const raw = atob(base64Payload.base64 || "");
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
      lastBlobUrl = blobUrl;
      assignedSrc = blobUrl;
      mediaDiagnostics.fetch = { mode: "blob-url-base64", blobSize: bytes.byteLength };
    } catch (base64Error) {
      mediaDiagnostics.fetch = {
        error: String(error),
        base64Error: String(base64Error),
        mode: "asset-url-fallback",
      };
    }
  }

  assistVideo.src = assignedSrc;
  assistVideo.load();
  assistVideo.playbackRate = Number(playbackRate.value || 1);

  printStatus({ message: "Preview proxy attached." });
}

async function loadAssistJsonFromPath(path) {
  const result = await invoke("load_manual_assist_json", { path });
  assistJsonPath.value = path;
  anchors = Array.isArray(result.anchors) ? result.anchors : [];
  if (targetFacePath && typeof result.targetFacePath === "string" && result.targetFacePath.trim()) targetFacePath.value = result.targetFacePath;
  if (assistTrackingEngine && typeof result.assistTrackingEngine === "string" && result.assistTrackingEngine.trim()) assistTrackingEngine.value = result.assistTrackingEngine;
  if (typeof result.sourceVideo === "string" && result.sourceVideo.trim()) {
    sourceVideoPath.value = result.sourceVideo;
    const info = await invoke("open_video", { path: result.sourceVideo });
    videoInfo = info;
    await attachPreviewForSource(result.sourceVideo);
  }
  renderAnchors();
  updateMeta();
  printStatus({ message: `Assist JSON loaded. anchors=${anchors.length}` });
}

async function togglePlayback(trigger = "button") {
  if (!assistVideo.src) {
    printStatus("No preview video src is attached yet.");
    return;
  }
  try {
    if (assistVideo.paused) {
      printStatus({ message: `Calling video.play() via ${trigger}...` });
      const p = assistVideo.play();
      if (p && typeof p.then === "function") await p;
      pushVideoEvent("playCallResolved", { trigger });
    } else {
      assistVideo.pause();
      pushVideoEvent("pauseCallResolved", { trigger });
    }
  } catch (e) {
    pushVideoEvent("playCallRejected", { trigger, message: String(e) });
    printStatus(`Video play failed: ${e}`);
  }
}

function isKeyboardShortcutAllowed(event) {
  if (event.defaultPrevented) return false;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return true;
  const tag = target.tagName;
  if (target.isContentEditable) return false;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return false;
  return true;
}

function getFrameStepSeconds() {
  const fps = Number(videoInfo?.fps || 0);
  if (Number.isFinite(fps) && fps > 0) return 1 / fps;
  return 1 / 30;
}

function seekBySeconds(deltaSec, trigger = "shortcut") {
  if (!assistVideo.src || !Number.isFinite(deltaSec)) return;
  const duration = Number.isFinite(assistVideo.duration) ? assistVideo.duration : Number(videoInfo?.durationSec || 0);
  const maxTime = duration > 0 ? Math.max(duration - 0.001, 0) : Number.MAX_SAFE_INTEGER;
  const nextTime = Math.min(Math.max((assistVideo.currentTime || 0) + deltaSec, 0), maxTime);
  assistVideo.currentTime = nextTime;
  pushVideoEvent("seekShortcut", { trigger, deltaSec, nextTime });
  updateMeta();
  redrawOverlay();
}

async function openSourceVideo() {
  try {
    const picked = await invoke("pick_video_file");
    if (!picked) {
      printStatus("Video selection cancelled.");
      return;
    }
    const info = await invoke("open_video", { path: picked });
    videoInfo = info;
    sourceVideoPath.value = picked;
    assistJsonPath.value = buildJsonPath(picked);
    await attachPreviewForSource(picked);
    anchors = [];
    renderAnchors();
    updateMeta();
    printStatus({ message: "Source video loaded for Reframe Assist." });
  } catch (e) {
    printStatus(String(e));
  }
}

assistOverlay.addEventListener("mousedown", (ev) => {
  if (!videoInfo) return;
  assistVideo.pause();
  const pt = getCanvasPoint(ev);
  dragStart = { x: pt.x, y: pt.y };
  dragRect = { x: dragStart.x, y: dragStart.y, w: 0, h: 0 };
  redrawOverlay();
});

assistOverlay.addEventListener("mousemove", (ev) => {
  if (!dragStart) return;
  const pt = getCanvasPoint(ev);
  dragRect = { x: dragStart.x, y: dragStart.y, w: pt.x - dragStart.x, h: pt.y - dragStart.y };
  redrawOverlay();
});

function finishDrag() {
  if (dragRect) addAnchorFromRect(dragRect);
  dragRect = null;
  dragStart = null;
  redrawOverlay();
}

assistOverlay.addEventListener("mouseup", finishDrag);
assistOverlay.addEventListener("mouseleave", () => {
  if (dragStart) finishDrag();
});

[
  "loadstart", "durationchange", "loadedmetadata", "loadeddata", "progress", "canplay", "canplaythrough",
  "play", "playing", "pause", "stalled", "suspend", "waiting", "abort", "emptied", "seeked", "seeking"
].forEach((name) => {
  assistVideo.addEventListener(name, () => {
    syncOverlaySize();
    updateMeta();
    pushVideoEvent(name);
  });
});

assistVideo.addEventListener("error", () => {
  const err = assistVideo.error;
  pushVideoEvent("error", { code: err?.code || null, message: err?.message || "" });
  printStatus({ message: `Video load error${err ? ` code=${err.code}` : ""}` });
});
assistVideo.addEventListener("timeupdate", () => {
  updateMeta();
  redrawOverlay();
});
window.addEventListener("resize", syncOverlaySize);

loadSettings();
loadAppConfigDefaults().then(() => {
  saveSettings();
  updateDiagnostics({}, true);
});
bindSlider(stability, stabilityValue);
playbackRate.addEventListener("change", () => {
  assistVideo.playbackRate = Number(playbackRate.value || 1);
  saveSettings();
  updateDiagnostics({}, true);
});
if (showAllAnchors) {
  showAllAnchors.addEventListener("change", () => {
    saveSettings();
    redrawOverlay();
  });
}
assistVideo.playbackRate = Number(playbackRate.value || 1);

$("openSourceBtn").addEventListener("click", openSourceVideo);
if (pickTargetFaceBtn) {
  pickTargetFaceBtn.addEventListener("click", async () => {
    try {
      const picked = await invoke("pick_folder_with_default", { startDir: targetFacePath.value.trim() || appConfig.targetFaceFolder || null });
      if (!picked) {
        printStatus("Face folder selection cancelled.");
        return;
      }
      targetFacePath.value = picked;
      saveSettings();
      printStatus("Target face folder selected for Assist.");
    } catch (e) {
      printStatus(String(e));
    }
  });
}
if (assistTrackingEngine) assistTrackingEngine.addEventListener("change", saveSettings);

$("playPauseBtn").addEventListener("click", async () => {
  await togglePlayback("button");
});

document.addEventListener("keydown", async (event) => {
  if (!isKeyboardShortcutAllowed(event)) return;

  if (event.code === "Space") {
    if (event.repeat) return;
    event.preventDefault();
    await togglePlayback("space");
    return;
  }

  if (event.code === "KeyJ") {
    event.preventDefault();
    seekBySeconds(-3, "keyJ");
    return;
  }

  if (event.code === "KeyL") {
    event.preventDefault();
    seekBySeconds(3, "keyL");
    return;
  }

  if (event.code === "ArrowLeft") {
    event.preventDefault();
    seekBySeconds(-getFrameStepSeconds(), "arrowLeft");
    return;
  }

  if (event.code === "ArrowRight") {
    event.preventDefault();
    seekBySeconds(getFrameStepSeconds(), "arrowRight");
  }
});

$("clearSelectionBtn").addEventListener("click", () => {
  dragRect = null;
  dragStart = null;
  redrawOverlay();
});
$("sortAnchorsBtn").addEventListener("click", () => {
  anchors.sort((a, b) => a.timeSec - b.timeSec);
  renderAnchors();
  printStatus("Anchors sorted by time.");
});
$("clearAnchorsBtn").addEventListener("click", () => {
  anchors = [];
  renderAnchors();
  updateMeta();
  printStatus("All anchors cleared.");
});
$("saveJsonBtn").addEventListener("click", saveAssistJson);
$("loadJsonBtn").addEventListener("click", async () => {
  try {
    const picked = await invoke("pick_json_file_with_default", { startDir: directoryOf(assistJsonPath.value) || appConfig.assistJsonDir || directoryOf(sourceVideoPath.value) || null });
    if (!picked) {
      printStatus("Assist JSON selection cancelled.");
      return;
    }
    await loadAssistJsonFromPath(picked);
  } catch (e) {
    printStatus(String(e));
  }
});
$("sendToReframeBtn").addEventListener("click", async () => {
  const path = assistJsonPath.value.trim();
  if (!path) {
    printStatus("Assist JSON path is empty.");
    return;
  }
  if (anchors.length >= 2) await saveAssistJson();
  const u = new URL("./reframe.html", window.location.href);
  u.searchParams.set("assistJson", path);
  window.location.href = u.toString();
});

if (!tauriInvoke) printStatus("Tauri API not available");

updateOverlayInteractivity();
setProgress(0, "Idle");
renderAnchors();
updateMeta();
updateDiagnostics({}, true);








