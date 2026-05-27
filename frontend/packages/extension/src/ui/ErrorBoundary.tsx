// Crash guard for any React surface (Side Panel + Options page).
//
// A render error would otherwise leave the surface completely blank with no
// way to recover short of closing and reopening. This catches the throw,
// logs to the console (background workers don't see these consoles, so this
// is the only diagnostic path), and shows a small reset / reload affordance.

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface in the panel's DevTools — the only place we can log inside a
    // chrome-extension:// page.
    console.error("[inkwell] React surface crashed:", error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  reload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950 px-6 text-zinc-100">
        <div className="max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-5 text-center shadow-2xl shadow-black/40">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/15 text-red-300">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="text-[14px] font-semibold tracking-tight text-zinc-50">
            Something went wrong
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">
            Inkwell hit an unexpected error. Try the action below — your saved settings and history
            are safe.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-[12px] font-medium text-zinc-100 transition-colors hover:border-zinc-600 hover:bg-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.reload}
              className="flex-1 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-3 py-2 text-[12px] font-semibold text-white shadow-md shadow-indigo-950/30 transition-colors hover:from-indigo-400 hover:to-violet-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
            >
              Reload
            </button>
          </div>
          {this.state.error.message && (
            <details className="mt-3 text-left">
              <summary className="cursor-pointer text-[10.5px] text-zinc-500 hover:text-zinc-300">
                Show error details
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-950 p-2 text-[10.5px] text-red-300">
                {this.state.error.message}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}
