import { Component, type ReactNode } from "react";

/**
 * Catches render/runtime errors in the subtree so a single bad component (e.g. a
 * malformed cast, a quoted cast with no author/embeds) shows a small fallback
 * instead of white-screening the entire app. Without this, any uncaught throw in
 * the tree unmounts everything and the user sees a blank page.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode; onReset?: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[ErrorBoundary] caught:", error);
  }

  reset = () => {
    this.setState({ hasError: false });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-10 px-6 text-center text-muted-foreground">
          <p className="text-sm font-semibold text-foreground">Something went wrong displaying this.</p>
          <button
            onClick={this.reset}
            className="px-4 py-2 rounded-xl bg-primary text-white text-[13px] font-bold hover:bg-primary/90 transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
