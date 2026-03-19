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
const RESET_NOTICE_KEY = "naVShorts.resetNotice.v1";
const REMEMBERED_UI_KEYS = [
  "naVShorts.effects.v1",
  "naVShorts.reframe.v2",
  "naVShorts.reframeAssist.v5",
];

const configPath = $("configPath");
const targetFaceFolder = $("targetFaceFolder");
const assistJsonDir = $("assistJsonDir");
const previewProxyDir = $("previewProxyDir");
const preReframeDefaultEngine = $("preReframeDefaultEngine");
const reframeDefaultEngine = $("reframeDefaultEngine");
const effectsDefaultZoomMode = $("effectsDefaultZoomMode");
const statusInfo = $("statusInfo");
const configInfo = $("configInfo");

async function invoke(cmd, payload) {
  if (!tauriInvoke) throw new Error("Tauri API not available");
  return tauriInvoke(cmd, payload);
}

function printStatus(value) {
  statusInfo.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function printConfig(value) {
  configInfo.textContent = JSON.stringify(value, null, 2);
}

function currentFolderValue(input) {
  return input?.value?.trim() || "";
}

async function loadConfig() {
  try {
    const cfg = await invoke("get_app_config");
    configPath.value = cfg.configPath || "";
    targetFaceFolder.value = cfg.targetFaceFolder || "";
    assistJsonDir.value = cfg.assistJsonDir || "";
    previewProxyDir.value = cfg.previewProxyDir || "";
    preReframeDefaultEngine.value = cfg.preReframeDefaultEngine || "yoloBytetrackArcface";
    reframeDefaultEngine.value = cfg.reframeDefaultEngine || "manualAssistJson";
    effectsDefaultZoomMode.value = cfg.effectsDefaultZoomMode || "zoomSineSmooth";
    printConfig(cfg);
    printStatus(`Settings loaded from ${cfg.configScope}: ${cfg.configPath}`);
  } catch (e) {
    printStatus(String(e));
  }
}

async function saveConfig() {
  try {
    const cfg = await invoke("save_app_config", {
      config: {
        targetFaceFolder: currentFolderValue(targetFaceFolder),
        assistJsonDir: currentFolderValue(assistJsonDir),
        previewProxyDir: currentFolderValue(previewProxyDir),
        preReframeDefaultEngine: preReframeDefaultEngine.value || "yoloBytetrackArcface",
        reframeDefaultEngine: reframeDefaultEngine.value || "manualAssistJson",
        effectsDefaultZoomMode: effectsDefaultZoomMode.value || "zoomSineSmooth",
      },
    });
    configPath.value = cfg.configPath || "";
    printConfig(cfg);
    printStatus(`Settings saved to ${cfg.configScope}: ${cfg.configPath}`);
  } catch (e) {
    printStatus(String(e));
  }
}

async function resetRememberedUiState() {
  try {
    const confirmed = window.confirm(
      "Reset all remembered UI state for Pre Reframe, Reframe, and Effects?\n\nA backup file will be written first."
    );
    if (!confirmed) {
      printStatus("Reset cancelled.");
      return;
    }

    const snapshot = {
      exportedAt: new Date().toISOString(),
      keys: REMEMBERED_UI_KEYS.map((key) => ({
        key,
        value: localStorage.getItem(key),
      })),
    };

    const result = await invoke("backup_ui_state_snapshot", { snapshot });
    for (const key of REMEMBERED_UI_KEYS) localStorage.removeItem(key);
    localStorage.setItem(
      RESET_NOTICE_KEY,
      JSON.stringify({
        at: new Date().toISOString(),
        message: "Remembered UI state was reset. Restart naVShorts to reopen each workspace with its configured initial defaults.",
        backupPath: result.backupPath,
      })
    );

    printStatus({
      message: "Remembered UI state reset complete.",
      backup: result,
      clearedKeys: REMEMBERED_UI_KEYS,
    });
  } catch (e) {
    printStatus(String(e));
  }
}

async function pickFolderInto(inputEl) {
  try {
    const picked = await invoke("pick_folder_with_default", { startDir: currentFolderValue(inputEl) || null });
    if (!picked) {
      printStatus("Folder selection cancelled.");
      return;
    }
    inputEl.value = picked;
  } catch (e) {
    printStatus(String(e));
  }
}

$("pickTargetFaceFolderBtn").addEventListener("click", () => pickFolderInto(targetFaceFolder));
$("pickAssistJsonDirBtn").addEventListener("click", () => pickFolderInto(assistJsonDir));
$("pickPreviewProxyDirBtn").addEventListener("click", () => pickFolderInto(previewProxyDir));
$("reloadConfigBtn").addEventListener("click", loadConfig);
$("saveConfigBtn").addEventListener("click", saveConfig);
$("resetUiStateBtn").addEventListener("click", resetRememberedUiState);
$("verifyBtn").addEventListener("click", async () => {
  try {
    const ffmpeg = await invoke("verify_runtime_tools");
    const onnx = await invoke("verify_onnx_runtime_assets");
    printStatus({ message: "Runtime tools verified.", ffmpeg, onnx });
  } catch (e) {
    printStatus(String(e));
  }
});

if (!tauriInvoke) {
  printStatus("Tauri API not available");
} else {
  loadConfig();
}
