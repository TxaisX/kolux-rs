// The Grok card (ACCT-008): Connect runs the Grok CLI's own browser login, "Sign in with a code"
// shows a link and a one-time code, and "Use an xAI API key" takes a pay-per-use key once, in a
// small dialog, and stores it sealed. A CLI sign-in wins over a saved key in what the card reports,
// and a sign-in the user already made shows as connected. Manage and Disconnect are T-202.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AttentionNote, fixFor, type Attention } from "./Attention";
import { OtherWays, taglineOf } from "./ConnectGrid";
import { settleWithin } from "./pending";

export type GrokView = {
  connection: "cli" | "key" | "none";
  signingIn: "browser" | "device" | null;
  inBrowser: boolean;
  deviceLink: string | null;
  deviceCode: string | null;
  attention: Attention | null;
};
export type GrokAction = "connect" | "code" | "key" | "cancel";
export type GrokState = "connecting" | "connected" | "attention" | "disconnected";

export function grokState(v: GrokView): GrokState {
  if (v.signingIn) return "connecting";
  if (v.connection !== "none") return "connected";
  return v.attention ? "attention" : "disconnected";
}

export function grokHeadline(v: GrokView): string {
  if (v.signingIn === "device") return v.deviceCode ? "Enter the code on any device" : "Asking for a sign-in code…";
  if (v.signingIn) return v.inBrowser ? "Finish signing in in the browser" : "Starting Grok's sign-in…";
  if (v.connection === "cli") return "Connected · Grok sign-in";
  if (v.connection === "key") return "Connected · xAI API key (pay-per-use)";
  return v.attention ? "Grok is not signed in yet" : "Connect with your Grok sign-in";
}

const chip: Record<GrokState, string> = { connecting: "Connecting", connected: "Connected", attention: "Needs attention", disconnected: "Not connected" };

export function GrokCardView({ view, pending, error, onAction }: { view: GrokView | null; pending: GrokAction | null; error?: string | null; onAction: (a: GrokAction) => void }) {
  if (!view) return null;
  const state = grokState(view);
  const fix = fixFor(view.attention, "grok");
  return (
    <section className="conn-card" aria-label="Grok" data-state={state}>
      <header className="conn-head">
        <span className="conn-name">Grok</span>
        <span className={`conn-chip ${state}`}>{chip[state]}</span>
      </header>
      <p className="conn-detail conn-tagline">{taglineOf("grok")}</p>
      <div className="conn-headline">{grokHeadline(view)}</div>
      {view.signingIn === "device" && view.deviceLink && view.deviceCode && (
        <div className="device-code" role="status">
          <p className="conn-detail">
            Open <span className="device-link">{view.deviceLink}</span> on this or another device, sign in, then confirm:
          </p>
          <code className="device-value">{view.deviceCode}</code>
        </div>
      )}
      {view.signingIn === "browser" && view.inBrowser && <p className="conn-detail">Sign in on the xAI page that opened in your browser.</p>}
      {state === "connected" && view.connection === "key" && <p className="conn-detail">Grok bills this key per use. A Grok sign-in, once you make one, takes its place.</p>}
      {state !== "connecting" && <AttentionNote attention={view.attention} route="grok" busy={pending !== null} onFix={() => onAction("connect")} />}
      {error && (
        <p className="conn-detail warn" role="alert">
          {error}
        </p>
      )}
      <div className="btn-row">
        {state === "connecting" || view.attention ? (
          <button className="btn" onClick={() => onAction("cancel")}>
            Cancel
          </button>
        ) : null}
        {state === "disconnected" || state === "attention" ? (
          <>
            {!fix && (
              <button className="btn primary" disabled={pending !== null} onClick={() => onAction("connect")}>
                Connect
              </button>
            )}
            <OtherWays
              ways={[
                { label: "Sign in with a code", onPick: () => onAction("code"), disabled: pending !== null },
                { label: "Use an xAI API key (advanced, pay-per-use)", onPick: () => onAction("key"), disabled: pending !== null },
              ]}
            />
          </>
        ) : null}
      </div>
    </section>
  );
}

/** ACCT-008: takes the key once. It stays mounted, so Cancel empties the field itself. */
export function GrokKeyDialog({ open, onSubmit, onClose }: { open: boolean; onSubmit: (key: string) => void; onClose: () => void }) {
  const [key, setKey] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  const cancel = () => {
    setKey("");
    onClose();
  };
  return (
    <div className="ask-backdrop" hidden={!open} onKeyDown={(e) => e.key === "Escape" && cancel()}>
      <form
        className="ask"
        role="dialog"
        aria-modal="true"
        aria-label="Use an xAI API key"
        onSubmit={(e) => {
          e.preventDefault();
          const k = key.trim();
          setKey("");
          if (k) onSubmit(k);
        }}
      >
        <h2 className="ask-title">Use an xAI API key</h2>
        <p className="ask-body">Advanced. xAI bills an API key per use, unlike the Grok sign-in. Kolux stores it sealed and never shows it again.</p>
        <input ref={input} className="field mono" type="password" autoComplete="off" spellCheck={false} aria-label="xAI API key" placeholder="xai-…" value={key} onChange={(e) => setKey(e.target.value)} />
        <div className="btn-row">
          <button type="button" className="btn" onClick={cancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={key.trim() === ""}>
            Connect
          </button>
        </div>
      </form>
    </div>
  );
}

export default function GrokCard() {
  const [view, setView] = useState<GrokView | null>(null);
  const [pending, setPending] = useState<GrokAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const read = useCallback(() => {
    invoke<GrokView>("grok_status")
      .then(setView)
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    read();
    let stop = () => {};
    listen("grok", read)
      .then((un) => (stop = un))
      .catch(() => {});
    return () => stop();
  }, [read]);
  const run = (a: GrokAction, call: Promise<unknown>) => {
    setError(null);
    if (a !== "cancel") setPending(a);
    call.catch((e) => setError(String(e)));
    void settleWithin(call).then(() => {
      setPending(null);
      read();
    });
  };
  const act = (a: GrokAction) => {
    if (a === "key") return setDialog(true);
    run(a, a === "cancel" ? invoke("grok_cancel") : invoke("grok_sign_in", { device: a === "code" }));
  };
  return (
    <>
      <GrokCardView view={view} pending={pending} error={error} onAction={act} />
      <GrokKeyDialog
        open={dialog}
        onClose={() => setDialog(false)}
        onSubmit={(key) => {
          setDialog(false);
          run("key", invoke("grok_key_set", { key }));
        }}
      />
    </>
  );
}
