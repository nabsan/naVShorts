import { useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Gauge, Settings, Sparkles } from "lucide-react";

import iconUrl from "../ui/assets/navshorts-icon-64.png";
import MotionWorkspace from "./features/motion/MotionWorkspace";
import ReframeWorkspace from "./features/reframe/ReframeWorkspace";
import SettingsWorkspace from "./features/settings/SettingsWorkspace";

const workspaces = [
  {
    id: "reframe",
    label: "Reframe",
    number: "01",
    href: "/legacy/reframe.html?embedded=1",
    page: "reframe.html",
    icon: Clapperboard,
    blurb: "Edit assist anchors and render the core 9:16 conversion in one continuous workflow.",
  },
  {
    id: "motion",
    label: "Motion",
    number: "02",
    href: "/legacy/index.html?embedded=1",
    page: "index.html",
    icon: Sparkles,
    blurb: "Apply quick effects or Cine Motion timing without breaking the current workflow.",
  },
  {
    id: "settings",
    label: "Settings",
    number: "03",
    href: "/legacy/settings.html?embedded=1",
    page: "settings.html",
    icon: Settings,
    blurb: "Shared folders, runtime health checks, and defaults stay centralized here.",
  },
];

function inferWorkspace(src) {
  const match = workspaces.find((item) => src.includes(item.page));
  return match?.id ?? workspaces[0].id;
}

function getWorkspaceHints(workspaceId) {
  switch (workspaceId) {
    case "reframe":
      return ["Pause to place anchors", "Manual Assist JSON is the default flow"];
    case "motion":
      return ["Space: play/pause", "Cine Motion shortcuts"];
    case "settings":
      return ["Shared defaults live here", "Use reset only when UI state is stale"];
    default:
      return [];
  }
}

function MotionShortcutPanel() {
  const items = [
    "Space: play / pause",
    "Arrow Left / Right: seek 5 sec",
    "Z: soft zoom in",
    "X: strong zoom in",
    "C: cursor focus",
    "V / B: pan left / pan right",
    "N / M: pan up / pan down",
    "Ctrl+Z: undo last event",
  ];

  return (
    <div className="mt-3 rounded-[24px] border border-line bg-white/72 p-3.5 shadow-panel">
      <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[#6b7280]">Motion Shortcuts</div>
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <div key={item} className="text-[13px] leading-6 text-muted">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [activeId, setActiveId] = useState(workspaces[0].id);
  const [handoffReframedPath, setHandoffReframedPath] = useState("");
  const [workspaceHrefs, setWorkspaceHrefs] = useState(() =>
    Object.fromEntries(workspaces.map((workspace) => [workspace.id, workspace.href])),
  );
  const iframeRef = useRef(null);
  const activeWorkspace = useMemo(
    () => workspaces.find((item) => item.id === activeId) ?? workspaces[0],
    [activeId],
  );
  const activeHints = useMemo(() => getWorkspaceHints(activeWorkspace.id), [activeWorkspace.id]);
  const activeHref = workspaceHrefs[activeWorkspace.id] || activeWorkspace.href;

  useEffect(() => {
    document.title = `naVShorts - ${activeWorkspace.label}`;
  }, [activeWorkspace]);

  const handleFrameLoad = () => {
    const frame = iframeRef.current;
    try {
      const href = frame?.contentWindow?.location?.href || frame?.src || "";
      setActiveId(inferWorkspace(href));
    } catch {
      // Same-origin in Tauri/Vite should allow this. Ignore if not available.
    }
  };

  const handleSendToMotion = (reframedPath) => {
    setHandoffReframedPath(reframedPath);
    setActiveId("motion");
  };

  return (
    <div className="min-h-screen bg-[#f2f2f7] text-ink">
      <div className="mx-auto flex min-h-screen max-w-[1760px] gap-3 px-3 py-3">
        <aside className="flex w-[220px] shrink-0 flex-col rounded-shell border border-line bg-card p-3 shadow-shell backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <img src={iconUrl} alt="naVShorts icon" className="h-12 w-12 rounded-2xl shadow-panel" />
            <div>
              <div className="text-[24px] font-semibold tracking-tight text-ink">naVShorts</div>
              <div className="text-[13px] text-muted">Vertical video workflow studio</div>
            </div>
          </div>

          <div className="mt-5 rounded-[24px] border border-white/70 bg-white/70 p-2.5 shadow-panel">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#6b7280]">
              <Gauge className="h-4 w-4" />
              Workflow
            </div>
            <div className="mt-3 space-y-1.5">
              {workspaces.map((workspace) => {
                const Icon = workspace.icon;
                const active = workspace.id === activeId;
                return (
                  <button
                    key={workspace.id}
                    type="button"
                    onClick={() => setActiveId(workspace.id)}
                    className={[
                      "flex w-full items-start gap-3 rounded-[20px] border px-3 py-2.5 text-left transition",
                      active
                        ? "border-accent/20 bg-accent text-white shadow-[0_18px_30px_rgba(0,113,227,0.28)]"
                        : "border-transparent bg-transparent text-ink hover:border-line hover:bg-white/85",
                    ].join(" ")}
                  >
                    <div
                      className={[
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl",
                        active ? "bg-white/16" : "bg-[#f5f7fb]",
                      ].join(" ")}
                    >
                      <Icon className={active ? "h-5 w-5 text-white" : "h-5 w-5 text-[#0f172a]"} />
                    </div>
                    <div className="min-w-0">
                      <div className={active ? "text-xs font-semibold uppercase tracking-[0.22em] text-white/70" : "text-xs font-semibold uppercase tracking-[0.22em] text-[#94a3b8]"}>
                        {workspace.number}
                      </div>
                      <div className={active ? "mt-0.5 text-[15px] font-semibold text-white" : "mt-0.5 text-[15px] font-semibold text-ink"}>
                        {workspace.label}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {activeWorkspace.id === "motion" ? (
            <MotionShortcutPanel />
          ) : (
            <div className="mt-3 rounded-[24px] border border-line bg-white/72 p-3.5 shadow-panel">
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[#6b7280]">Design direction</div>
              <p className="mt-2 text-[13px] leading-6 text-muted">
                Apple-inspired calm surfaces, clear hierarchy, and dense work tools without the current visual noise.
              </p>
            </div>
          )}

          <div className="mt-auto rounded-[24px] border border-line bg-[#101828] p-3.5 text-white shadow-panel">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-white/60">Current focus</div>
            <div className="mt-2 text-[17px] font-semibold">{activeWorkspace.label}</div>
            <p className="mt-2 text-[13px] leading-6 text-white/72">{activeWorkspace.blurb}</p>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col rounded-shell border border-line bg-card p-3 shadow-shell backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4 border-b border-line pb-2.5">
            <div className="flex min-h-[48px] items-center gap-2">
              {activeHints.map((hint) => (
                <div
                  key={hint}
                  className="rounded-full border border-line bg-[#f8fafc] px-3 py-2 text-[13px] font-medium text-muted shadow-[0_8px_18px_rgba(15,23,42,0.04)]"
                >
                  {hint}
                </div>
              ))}
            </div>
            <div className="inline-flex rounded-full border border-line bg-white/80 p-1 shadow-panel">
              {workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => setActiveId(workspace.id)}
                  className={[
                    "rounded-full px-3.5 py-2 text-sm font-semibold transition",
                    workspace.id === activeId
                      ? "bg-accent text-white shadow-[0_12px_26px_rgba(0,113,227,0.28)]"
                      : "text-[#475467] hover:bg-[#eef2f7]",
                  ].join(" ")}
                >
                  {workspace.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 flex min-h-0 flex-1 rounded-[28px] border border-white/70 bg-white/72 p-2 shadow-panel">
            {activeWorkspace.id === "reframe" ? (
              <div className="h-full min-h-[760px] w-full rounded-[22px]">
                <ReframeWorkspace onSendToMotion={handleSendToMotion} />
              </div>
            ) : activeWorkspace.id === "motion" ? (
              <div className="h-full min-h-[760px] w-full rounded-[22px]">
                <MotionWorkspace reframedInput={handoffReframedPath} />
              </div>
            ) : activeWorkspace.id === "settings" ? (
              <div className="h-full min-h-[760px] w-full rounded-[22px]">
                <SettingsWorkspace />
              </div>
            ) : (
              <iframe
                ref={iframeRef}
                key={activeHref}
                title={activeWorkspace.label}
                src={activeHref}
                onLoad={handleFrameLoad}
                className="h-full min-h-[760px] w-full rounded-[22px] border border-line bg-transparent"
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
