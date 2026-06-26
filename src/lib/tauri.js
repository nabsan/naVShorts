export function resolveInvoke() {
  const modern = window.__TAURI__?.core?.invoke;
  if (typeof modern === "function") return modern;

  const legacy = window.__TAURI__?.tauri?.invoke;
  if (typeof legacy === "function") return legacy;

  const internal = window.__TAURI_INTERNALS__?.invoke;
  if (typeof internal === "function") return (cmd, payload) => internal(cmd, payload);

  return null;
}

export function resolveConvertFileSrc() {
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

export async function invoke(command, payload) {
  if (!tauriInvoke) throw new Error("Tauri API not available");
  return tauriInvoke(command, payload);
}

export function toVideoSrc(path) {
  const normalized = path.replace(/\\/g, "/");
  if (convertFileSrc) {
    try {
      return convertFileSrc(normalized);
    } catch {
      // fall through
    }
  }
  return normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
}

export function hasTauri() {
  return Boolean(tauriInvoke);
}
