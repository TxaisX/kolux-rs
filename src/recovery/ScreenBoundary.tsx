// T-183 (APP-042): a thrown render error never leaves a blank window. The boundary shows what broke
// with Try again (remounts the tree) and Reload (reloads the page). A page showing this still sends
// its heartbeat only through RecoveryMount inside the tree, so a boundary that stays up long enough
// is also caught by the watch in recovery.rs (one reload, one retry, then the native prompt).
import React from "react";
import { boundaryMessage } from "./model";
import { CrashFeedback, ReportButton } from "../crash";

type Props = { children: React.ReactNode };
type State = { error: unknown; tries: number };

export default class ScreenBoundary extends React.Component<Props, State> {
  state: State = { error: null, tries: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  render() {
    if (this.state.error === null) return <React.Fragment key={this.state.tries}>{this.props.children}</React.Fragment>;
    return (
      <div role="alert" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, maxWidth: 560, margin: "48px auto", color: "var(--fg-row)" }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Kolux hit a problem</h2>
        <p style={{ margin: 0 }}>{boundaryMessage(this.state.error)}</p>
        <p style={{ margin: 0, opacity: 0.8 }}>Your terminals keep running. Try again brings the interface back; Reload starts the page over.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => this.setState((s) => ({ error: null, tries: s.tries + 1 }))}>
            Try again
          </button>
          <button className="btn" onClick={() => window.location.reload()}>
            Reload
          </button>
          {/* T-249-c (PROJ-089): Send Feedback with the crash text above the block */}
          <ReportButton error={this.state.error} />
        </div>
        <CrashFeedback />
      </div>
    );
  }
}
