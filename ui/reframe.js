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

const SETTINGS_KEY = "naVShorts.reframe.v1";

const sourceVideoPath = $("sourceVideoPath");
const targetFacePath = $("targetFacePath");
const pickTargetFaceBtn = $("pickTargetFaceBtn");
const reframeOutputPath = $("reframeOutputPath");
const encoder = $("encoder");
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
  statusInfo.textContent =
    typeof textOrObject === "string"
      ? textOrObject
      : JSON.stringify(textOrObject, null, 2);
}

function setProgress(progress, etaText) {
  renderProgress.value = Number.isFinite(progress)
    ? Math.min(Math.max(progress, 0), 1)
    : 0;
  etaInfo.textContent = etaText;
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
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (typeof s.trackingStrength === "number") trackingStrength.value = String(s.trackingStrength);
    if (typeof s.identityThreshold === "number") identityThreshold.value = String(s.identityThreshold);
    if (typeof s.stability === "number") stability.value = String(s.stability);
    if (typeof s.encoder === "string") encoder.value = s.encoder;
  } catch {
    // ignore broken local settings
  }
}

function saveSettings() {
  const payload = {
    trackingStrength: Number(trackingStrength.value),
    identityThreshold: Number(identityThreshold.value),
    stability: Number(stability.value),
    encoder: encoder.value,
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
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
    const tracking = Number(trackingStrength?.value ?? 0.72);
    const idThr = Number(identityThreshold?.value ?? 0.58);
    const stab = Number(stability?.value ?? 0.68);

    if (!input) {
      printStatus("Source video path is empty.");
      return;
    }
    if (!out) {
      printStatus("Reframe output path is empty.");
      return;
    }

    const jobId = await invoke("render_reframe", {
      request: {
        inputPath: input,
        outputPath: out,
        targetFacePath: face || null,
        preview,
        encoder: encoder.value,
        trackingStrength: Number.isFinite(tracking) ? tracking : 0.72,
        identityThreshold: Number.isFinite(idThr) ? idThr : 0.58,
        stability: Number.isFinite(stab) ? stab : 0.68,
      },
    });

    const status = await trackRenderJob(jobId);
    if (status && status.state === "completed") {
      lastOutput = out;
      const faceRef = face || "(none)";
      printStatus(`Reframe complete. Face reference: ${faceRef} | tracking=${tracking.toFixed(2)} id=${idThr.toFixed(2)} stability=${stab.toFixed(2)}`);
    }
  } catch (e) {
    printStatus(String(e));
  }
}

loadSettings();
bindSlider(trackingStrength, trackingStrengthValue);
bindSlider(identityThreshold, identityThresholdValue);
bindSlider(stability, stabilityValue);
encoder.addEventListener("change", saveSettings);

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
      printStatus("Target face folder selected.");
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

if (!tauriInvoke) {
  printStatus("Tauri API not available");
}

setProgress(0, "Idle");
verifyTools().catch(() => {});
refreshProject().catch(() => {});
