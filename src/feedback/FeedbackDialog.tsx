// APP-037 / PROJ-089 on screen: the Send Feedback message box. It opens already holding the version
// and system under a rule, the user writes above it, ticks Submit anonymously if they like, and
// Open on GitHub hands the finished new-issue address to the browser. The app sends nothing.
// Mounted once (App.tsx); anything that wants it calls requestFeedback().
import { useEffect, useReducer, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppInfo } from "../app-info";
import type { FeedbackFacts } from "../settings/privacy";
import { closed, issue, reduce, tabTarget, typedText } from "./model";

const EVENT = "kolux-feedback";
const NOTE_MS = 8000;

/** Opens the message box, optionally with some text already above the block. */
export function requestFeedback(text = "") {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { text } }));
}

/** The version from the app, the system from the back end; what cannot be read says so. */
async function readFacts(): Promise<FeedbackFacts> {
  const info = await invoke<AppInfo>("app_info").catch(() => null);
  const sys = await invoke<{ release: string; arch: string; login: string | null }>("feedback_facts").catch(() => null);
  return { version: info?.version ?? "unknown", platform: navigator.platform || "unknown", release: sys?.release ?? "unknown", arch: sys?.arch ?? "unknown", login: sys?.login ?? null };
}

export default function FeedbackDialog() {
  const [s, dispatch] = useReducer(reduce, closed);
  const box = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const on = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text ?? "";
      void readFacts().then((facts) => dispatch({ t: "open", facts, text }));
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  // The cursor starts above the block, where the user types.
  useEffect(() => {
    if (!s.open) return;
    const el = box.current;
    if (!el) return;
    el.focus();
    const end = typedText(el.value).length;
    el.setSelectionRange(end, end);
  }, [s.open]);

  // The note after a send fades on its own.
  useEffect(() => {
    if (s.open || !s.note) return;
    const t = window.setTimeout(() => dispatch({ t: "close" }), NOTE_MS);
    return () => window.clearTimeout(t);
  }, [s.open, s.note]);

  const send = () => {
    if (!s.facts) return;
    // FIX-1: whatever goes wrong while the address is built shows in the box; the button never does nothing
    try {
      const r = issue(s.draft, s.facts, s.anonymous);
      if (!r.ok) return dispatch({ t: "fail", error: r.error });
      invoke("open_external", { url: r.url }).then(
        () => dispatch({ t: "sent", trimmed: r.trimmed }),
        (e: unknown) => dispatch({ t: "fail", error: `Could not open the browser: ${String(e)}` }),
      );
    } catch (e) {
      dispatch({ t: "fail", error: `Could not build the report: ${String(e)}` });
    }
  };

  if (!s.open) {
    return s.note ? (
      <div role="status" className="conn-detail" style={{ position: "fixed", left: 16, bottom: 16, maxWidth: 360, padding: "10px 12px", zIndex: 50, background: "var(--pane-bg)", border: "1px solid var(--line-subtle)", borderRadius: 8, color: "var(--fg-row)" }}>
        {s.note}
      </div>
    ) : null;
  }
  return (
    <div className="scrim" onMouseDown={() => dispatch({ t: "close" })}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Send feedback"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") dispatch({ t: "close" });
          else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
          else if (e.key === "Tab") {
            // APP-037: the box is modal; Tab never leaves it.
            const items = [...e.currentTarget.querySelectorAll<HTMLElement>("textarea, input, button:not([disabled])")];
            const to = tabTarget(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
            if (to >= 0) {
              e.preventDefault();
              items[to].focus();
            }
          }
        }}
        style={{ width: "min(640px, calc(100vw - 48px))", display: "flex", flexDirection: "column", gap: 10, padding: "16px 18px", background: "var(--pane-bg)", border: "1px solid var(--line-focus)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0, 0, 0, 0.5)", color: "var(--fg)" }}
      >
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Send feedback</h2>
        <p className="conn-detail" style={{ margin: 0 }}>
          Write what happened or what you would like. Paths and secrets are removed before anything is filled in. Your browser opens GitHub's new-issue page; you read it there and submit it yourself, the app sends nothing.
        </p>
        <textarea
          ref={box}
          className="field auto-prompt"
          aria-label="Your feedback"
          style={{ minHeight: 220 }}
          value={s.draft}
          onChange={(e) => dispatch({ t: "type", draft: e.target.value })}
        />
        <label className="auto-radio">
          <input type="checkbox" checked={s.anonymous} onChange={(e) => dispatch({ t: "anon", on: e.target.checked })} /> Submit anonymously (leave my GitHub name out)
        </label>
        {s.error && (
          <p role="alert" className="conn-detail" style={{ margin: 0, color: "var(--danger)" }}>
            {s.error}
          </p>
        )}
        <div className="auto-dialog-foot">
          <span className="muted">Everything under the line is added for you.</span>
          <button className="btn" onClick={() => dispatch({ t: "close" })}>
            Cancel
          </button>
          <button className="btn primary" onClick={send}>
            Open on GitHub
          </button>
        </div>
      </div>
    </div>
  );
}
