function resolveInvoke() {
  const modern = window.__TAURI__?.core?.invoke;
  if (typeof modern === "function") {
    return modern;
  }

  const legacy = window.__TAURI__?.tauri?.invoke;
  if (typeof legacy === "function") {
    return legacy;
  }

  const internal = window.__TAURI_INTERNALS__?.invoke;
  if (typeof internal === "function") {
    return (cmd, payload) => internal(cmd, payload);
  }

  return null;
}

const tauriInvoke = resolveInvoke();
const $ = (id) => document.getElementById(id);

const sourceVideoPath = $("sourceVideoPath");
const targetFacePath = $("targetFacePath");
const pickTargetFaceBtn = $("pickTargetFaceBtn");
const reframeOutputPath = $("reframeOutputPath");
const encoder = $("encoder");
const trackingStrength = $("trackingStrength");
const trackingStrengthValue = $("trackingStrengthValue");

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
    const result = await invoke("verify_runtime_tools");
    printStatus(result);
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
    const input = sourceVideoPath.value.trim();
    const out = reframeOutputPath.value.trim();
    const face = targetFacePath.value.trim();
    const tracking = Number(trackingStrength?.value ?? 0.65);

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
        trackingStrength: Number.isFinite(tracking) ? tracking : 0.65,
      },
    });

    const status = await trackRenderJob(jobId);
    if (status && status.state === "completed") {
      lastOutput = out;
      const faceRef = face || "(none)";
      printStatus(`Reframe complete. Face reference: ${faceRef} | tracking strength: ${tracking.toFixed(2)}`);
    }
  } catch (e) {
    printStatus(String(e));
  }
}

if (trackingStrength && trackingStrengthValue) {
  const syncTrackingText = () => {
    trackingStrengthValue.textContent = Number(trackingStrength.value).toFixed(2);
  };
  trackingStrength.addEventListener("input", syncTrackingText);
  syncTrackingText();
}

$("verifyBtn").addEventListener("click", verifyTools);

if (pickTargetFaceBtn) {
  pickTargetFaceBtn.addEventListener("click", async () => {
    try {
      const picked = await invoke("pick_image_file");
      if (!picked) {
        printStatus("Face image selection cancelled.");
        return;
      }
      targetFacePath.value = picked;
      printStatus("Target face image selected.");
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

$("backToEffectsBtn").addEventListener("click", () => {
  window.location.href = "./index.html";
});

if (!tauriInvoke) {
  printStatus("Tauri API not available");
}

setProgress(0, "Idle");
verifyTools().catch(() => {});
refreshProject().catch(() => {});


