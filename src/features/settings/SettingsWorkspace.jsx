import { useEffect, useMemo, useState } from "react";
import { FolderOpen, RefreshCw, RotateCcw, Save, ShieldCheck } from "lucide-react";

import { invoke } from "../../lib/tauri";

const RESET_NOTICE_KEY = "naVShorts.resetNotice.v1";
const REMEMBERED_UI_KEYS = [
  "naVShorts.effects.v1",
  "naVShorts.motion.v1",
  "naVShorts.cineMotion.v1",
  "naVShorts.reframe.v2",
  "naVShorts.reframeAssist.v5",
];

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

export default function SettingsWorkspace() {
  const [configPath, setConfigPath] = useState("");
  const [configScope, setConfigScope] = useState("");
  const [targetFaceFolder, setTargetFaceFolder] = useState("");
  const [workDir, setWorkDir] = useState("");
  const [workDirCleanupLimitGb, setWorkDirCleanupLimitGb] = useState("20");
  const [assistJsonDir, setAssistJsonDir] = useState("");
  const [previewProxyDir, setPreviewProxyDir] = useState("");
  const [preReframeDefaultEngine, setPreReframeDefaultEngine] = useState("yoloBytetrackArcface");
  const [reframeDefaultEngine, setReframeDefaultEngine] = useState("manualAssistJson");
  const [effectsDefaultZoomMode, setEffectsDefaultZoomMode] = useState("zoomSineSmooth");
  const [statusText, setStatusText] = useState("Idle.");
  const [configInfo, setConfigInfo] = useState("No config loaded.");

  const printConfig = (value) => setConfigInfo(JSON.stringify(value, null, 2));

  const loadConfig = async () => {
    try {
      const cfg = await invoke("get_app_config");
      setConfigPath(cfg.configPath || "");
      setConfigScope(cfg.configScope || "");
      setTargetFaceFolder(cfg.targetFaceFolder || "");
      setWorkDir(cfg.workDir || "");
      setWorkDirCleanupLimitGb(String(cfg.workDirCleanupLimitGb || 20));
      setAssistJsonDir(cfg.assistJsonDir || "");
      setPreviewProxyDir(cfg.previewProxyDir || "");
      setPreReframeDefaultEngine(cfg.preReframeDefaultEngine || "yoloBytetrackArcface");
      setReframeDefaultEngine(cfg.reframeDefaultEngine || "manualAssistJson");
      setEffectsDefaultZoomMode(cfg.effectsDefaultZoomMode || "zoomSineSmooth");
      printConfig(cfg);
      setStatusText(`Settings loaded from ${cfg.configScope}: ${cfg.configPath}`);
    } catch (error) {
      setStatusText(String(error));
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const saveConfig = async () => {
    try {
      const cfg = await invoke("save_app_config", {
        config: {
          targetFaceFolder: targetFaceFolder.trim(),
          workDir: workDir.trim(),
          workDirCleanupLimitGb: Number(workDirCleanupLimitGb) || 20,
          assistJsonDir: assistJsonDir.trim(),
          previewProxyDir: previewProxyDir.trim(),
          preReframeDefaultEngine,
          reframeDefaultEngine,
          effectsDefaultZoomMode,
        },
      });
      setConfigPath(cfg.configPath || "");
      setConfigScope(cfg.configScope || "");
      setTargetFaceFolder(cfg.targetFaceFolder || "");
      setWorkDir(cfg.workDir || "");
      setWorkDirCleanupLimitGb(String(cfg.workDirCleanupLimitGb || 20));
      setAssistJsonDir(cfg.assistJsonDir || "");
      setPreviewProxyDir(cfg.previewProxyDir || "");
      setPreReframeDefaultEngine(cfg.preReframeDefaultEngine || "yoloBytetrackArcface");
      setReframeDefaultEngine(cfg.reframeDefaultEngine || "manualAssistJson");
      setEffectsDefaultZoomMode(cfg.effectsDefaultZoomMode || "zoomSineSmooth");
      printConfig(cfg);
      setStatusText(`Settings saved to ${cfg.configScope}: ${cfg.configPath}`);
    } catch (error) {
      setStatusText(String(error));
    }
  };

  const pickFolderInto = async (setter, currentValue) => {
    try {
      const picked = await invoke("pick_folder_with_default", { startDir: currentValue.trim() || null });
      if (!picked) {
        setStatusText("Folder selection cancelled.");
        return;
      }
      setter(picked);
    } catch (error) {
      setStatusText(String(error));
    }
  };

  const resetRememberedUiState = async () => {
    try {
      const confirmed = window.confirm(
        "Reset all remembered UI state for Pre Reframe, Reframe, and Motion?\n\nA backup file will be written first.",
      );
      if (!confirmed) {
        setStatusText("Reset cancelled.");
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
      REMEMBERED_UI_KEYS.forEach((key) => localStorage.removeItem(key));
      localStorage.setItem(
        RESET_NOTICE_KEY,
        JSON.stringify({
          at: new Date().toISOString(),
          message: "Remembered UI state was reset. Restart naVShorts to reopen each workspace with its configured initial defaults.",
          backupPath: result.backupPath,
        }),
      );

      setStatusText(
        JSON.stringify(
          {
            message: "Remembered UI state reset complete.",
            backup: result,
            clearedKeys: REMEMBERED_UI_KEYS,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      setStatusText(String(error));
    }
  };

  const verifyRuntime = async () => {
    try {
      const ffmpeg = await invoke("verify_runtime_tools");
      const onnx = await invoke("verify_onnx_runtime_assets");
      setStatusText(JSON.stringify({ message: "Runtime tools verified.", ffmpeg, onnx }, null, 2));
    } catch (error) {
      setStatusText(String(error));
    }
  };

  const configSummary = useMemo(() => configInfo, [configInfo]);

  return (
    <div className="grid min-h-full grid-cols-[minmax(0,1.2fr)_360px] gap-4">
      <section className="rounded-[28px] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur-xl">
        <h1 className="text-[34px] font-semibold tracking-tight text-ink">Settings</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Manage shared runtime settings, default folders, and the initial modes each workspace should open with.
        </p>

        <div className="mt-4 grid gap-3 rounded-[24px] border border-line bg-[#f8fafc]/80 p-4">
          <div className="grid gap-2">
            <div className="text-sm font-semibold text-[#344054]">Config file</div>
            <input value={configPath} readOnly className="app-input app-input-readonly" />
          </div>

          <div className="grid gap-2">
            <div className="text-sm font-semibold text-[#344054]">Default target face folder</div>
            <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-3">
              <input value={targetFaceFolder} onChange={(e) => setTargetFaceFolder(e.target.value)} placeholder="Blank = no default target folder" className="app-input" />
              <ActionButton icon={FolderOpen} onClick={() => pickFolderInto(setTargetFaceFolder, targetFaceFolder)} className="app-btn-secondary">
                Pick Folder
              </ActionButton>
            </div>
          </div>

          <div className="grid gap-2">
            <div className="text-sm font-semibold text-[#344054]">naVShorts work directory</div>
            <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-3">
              <input value={workDir} onChange={(e) => setWorkDir(e.target.value)} placeholder="S:\\tools\\codex\\workdir\\naVShorts" className="app-input" />
              <ActionButton icon={FolderOpen} onClick={() => pickFolderInto(setWorkDir, workDir)} className="app-btn-secondary">
                Pick Folder
              </ActionButton>
            </div>
            <div className="text-sm leading-6 text-muted">
              Generated Assist JSON, render outputs, export logs, and debug text files should be kept here instead of beside the source video.
            </div>
          </div>

          <Field label="Work directory cleanup limit (GB)">
            <input
              value={workDirCleanupLimitGb}
              onChange={(e) => setWorkDirCleanupLimitGb(e.target.value)}
              type="number"
              min="1"
              step="1"
              className="app-input"
            />
          </Field>

          <div className="grid gap-2">
            <div className="text-sm font-semibold text-[#344054]">Assist JSON picker directory</div>
            <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-3">
              <input value={assistJsonDir} onChange={(e) => setAssistJsonDir(e.target.value)} placeholder="Blank = use naVShorts work directory when opening JSON" className="app-input" />
              <ActionButton icon={FolderOpen} onClick={() => pickFolderInto(setAssistJsonDir, assistJsonDir)} className="app-btn-secondary">
                Pick Folder
              </ActionButton>
            </div>
            <div className="text-sm leading-6 text-muted">
              New Assist JSON files are generated in the work directory. This picker directory is only used as a starting folder when loading an existing JSON.
            </div>
          </div>

          <div className="grid gap-2">
            <div className="text-sm font-semibold text-[#344054]">Preview proxy directory</div>
            <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-3">
              <input value={previewProxyDir} onChange={(e) => setPreviewProxyDir(e.target.value)} placeholder="Blank = system temp directory" className="app-input" />
              <ActionButton icon={FolderOpen} onClick={() => pickFolderInto(setPreviewProxyDir, previewProxyDir)} className="app-btn-secondary">
                Pick Folder
              </ActionButton>
            </div>
          </div>

          <h2 className="mt-2 text-[26px] font-semibold tracking-tight text-ink">Workspace Defaults</h2>

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
            <Field label="Config file">
              <select value={preReframeDefaultEngine} onChange={(e) => setPreReframeDefaultEngine(e.target.value)} className="app-select">
                <option value="yoloBytetrackArcface">Assist with YOLO + ByteTrack + ArcFace</option>
                <option value="faceIdentity">Assist with Face Identity (ONNX)</option>
                <option value="yoloDeepsortPerson">Assist with YOLO + DeepSORT</option>
                <option value="manualOnly">Manual only</option>
              </select>
            </Field>
            <Field label="Reframe default engine">
              <select value={reframeDefaultEngine} onChange={(e) => setReframeDefaultEngine(e.target.value)} className="app-select">
                <option value="manualAssistJson">Manual Assist JSON</option>
                <option value="yoloBytetrackArcface">Person YOLO + ByteTrack + ArcFace</option>
                <option value="yoloDeepsortPerson">Person YOLO + DeepSORT</option>
                <option value="faceIdentity">Face Identity (ONNX)</option>
              </select>
            </Field>
          </div>

          <div className="grid gap-3">
            <Field label="Quick Effects default zoom mode">
              <select value={effectsDefaultZoomMode} onChange={(e) => setEffectsDefaultZoomMode(e.target.value)} className="app-select">
                <option value="zoomSineSmooth">Zoom Sine Smooth (tmix optional)</option>
                <option value="zoomIn">Zoom In</option>
                <option value="zoomOut">Zoom Out</option>
                <option value="zoomInOutBeat">Zoom In &amp; Out to Beat</option>
                <option value="zoomInOutLoop">Zoom In &amp; Out Loop</option>
                <option value="none">None</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <ActionButton icon={RefreshCw} onClick={loadConfig} className="app-btn-ghost">
              Reload Settings
            </ActionButton>
            <ActionButton icon={Save} onClick={saveConfig} className="app-btn-primary">
              Save Settings
            </ActionButton>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <ActionButton icon={RotateCcw} onClick={resetRememberedUiState} className="app-btn-secondary">
              Reset Remembered UI State
            </ActionButton>
            <ActionButton icon={ShieldCheck} onClick={verifyRuntime} className="app-btn-secondary">
              Verify FFmpeg / ONNX
            </ActionButton>
          </div>

          <div className="rounded-[18px] border border-line bg-[#f8fafc] px-4 py-4 text-sm leading-6 text-muted">
            Settings are stored in <code>naVShorts.config</code> next to the executable when possible. If that location is not writable, the app falls back to Local AppData.
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-white/70 bg-white/78 p-5 shadow-panel backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-[26px] font-semibold tracking-tight text-ink">Status</h2>
          <div className="text-sm font-medium text-muted">{configScope || "runtime"}</div>
        </div>
        <pre className="mt-4 h-[220px] overflow-auto rounded-[20px] border border-line bg-[#f8fafc] p-4 text-xs leading-6 text-[#344054]">
          {statusText}
        </pre>

        <h2 className="mt-6 text-[26px] font-semibold tracking-tight text-ink">Current Config</h2>
        <pre className="mt-4 h-[300px] overflow-auto rounded-[20px] border border-line bg-[#f8fafc] p-4 text-xs leading-6 text-[#344054]">
          {configSummary}
        </pre>
      </section>
    </div>
  );
}
