import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./styles.css";

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("naVShorts render failed", error, errorInfo);
  }

  resetMotionState = () => {
    window.localStorage.removeItem("naVShorts.cineMotion.v1");
    window.location.reload();
  };

  resetAllUiState = () => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("naVShorts.")) {
        window.localStorage.removeItem(key);
      }
    }
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
          <section className="mx-auto max-w-3xl rounded-[28px] border border-red-400/30 bg-white/10 p-8 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-red-200">
              Render Error
            </p>
            <h1 className="mt-3 text-3xl font-semibold">naVShorts could not render.</h1>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              A saved UI state may be incompatible with the current version. Try resetting the
              Motion state first. If the app still does not open, clear all naVShorts UI state.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button className="button-primary w-auto px-5" onClick={this.resetMotionState}>
                Reset Motion State
              </button>
              <button className="button-secondary w-auto px-5" onClick={this.resetAllUiState}>
                Clear naVShorts UI State
              </button>
            </div>
            <pre className="mt-6 max-h-64 overflow-auto rounded-2xl bg-slate-950/80 p-4 text-xs text-red-100">
              {String(this.state.error?.stack || this.state.error)}
            </pre>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
