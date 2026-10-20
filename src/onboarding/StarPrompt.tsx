// ONB-037 / ONB-038: the GitHub star card and toast. Mounted next to the guides. It shows only when the app has a
// public repository (star_info answers an empty one until then, OD-16) and stars only on the user's own click.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppInfo } from "../app-info";
import {
  completedState, createStar, dismissed, emptyScreen, finishedTask, hidden, onboardingToast, showing, stateOf, STAR_EVENT, STAR_SETTING, thresholdDue, withVersion,
  type Screen, type StarEvent, type StarState, type StarUi,
} from "./star";

type Info = { repo: string; starred: boolean | null };

export default function StarPrompt() {
  const state = useRef<StarState | null>(null);
  const info = useRef<Info>({ repo: "", starred: null });
  const version = useRef("");
  const launched = useRef(0);
  const screen = useRef<Screen>(emptyScreen());
  const [view, setView] = useState<{ kind: "card" | "toast"; ui: StarUi } | null>(null);
  const flow = useRef<ReturnType<typeof createStar> | null>(null);

  const save = (s: StarState) => {
    state.current = s;
    invoke("settings_patch", { set: { [STAR_SETTING]: s }, remove: [] }).catch(() => {});
  };
  const open = (kind: "card" | "toast") => {
    flow.current?.abandon();
    screen.current = showing(screen.current, kind);
    if (screen.current.shown?.kind !== kind) return;
    flow.current = createStar(
      {
        check: async () => (await invoke<Info>("star_info")).starred,
        put: () => invoke<void>("star_put"),
      },
      (ui) => {
        setView((v) => (v ? { ...v, ui } : v));
        if (ui === "thanks" && state.current) save(completedState(state.current));
      },
    );
    setView({ kind, ui: "idle" });
  };
  const ctx = () => ({ now: Date.now(), starred: info.current.starred, window: !document.hidden });
  const ready = () => !!state.current && info.current.repo !== "";

  useEffect(() => {
    Promise.all([invoke<Record<string, unknown>>("get_settings"), invoke<AppInfo>("app_info"), invoke<Info>("star_info")]).then(
      ([settings, app, star]) => {
        version.current = app.version;
        info.current = star;
        state.current = withVersion(stateOf(settings[STAR_SETTING]), app.version, launched.current);
      },
      () => {},
    );
    const on = (e: Event) => {
      const ev = (e as CustomEvent<StarEvent>).detail;
      if (ev.kind === "launch") launched.current += 1;
      if (!ready()) return;
      const s = state.current!;
      if (ev.kind === "onboarding-done" && onboardingToast(s, ctx())) open("toast");
      else if (ev.kind === "launch" && thresholdDue(s, launched.current, ctx())) open("card");
      else if (ev.kind === "task-finished") {
        const r = finishedTask(s, version.current, ctx(), ev);
        if (r.state !== s) save(r.state);
        if (r.show) open("card");
      }
    };
    window.addEventListener(STAR_EVENT, on);
    return () => window.removeEventListener(STAR_EVENT, on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const later = useCallback(() => {
    if (!state.current || !flow.current?.canDismiss()) return;
    const r = dismissed(state.current, screen.current, Date.now(), launched.current);
    screen.current = r.screen;
    save(r.state);
    flow.current.abandon();
    setView(null);
  }, []);
  const closeThanks = () => {
    screen.current = hidden(screen.current);
    setView(null);
  };

  if (!view) return null;
  const busy = view.ui === "busy";
  return (
    <div className={`star-${view.kind}`} role="status">
      {view.ui === "thanks" ? (
        <>
          <span>Thank you for the star.</span>
          <button className="btn" onClick={closeThanks}>
            Close
          </button>
        </>
      ) : (
        <>
          <span>Enjoying Kolux? A star on GitHub helps other people find it.</span>
          {view.ui === "fallback" ? (
            <a className="btn primary" href={`https://github.com/${info.current.repo}`} target="_blank" rel="noreferrer">
              Open GitHub
            </a>
          ) : (
            <button className="btn primary" disabled={busy} onClick={() => void flow.current?.click()}>
              {busy ? "Starring..." : "Star on GitHub"}
            </button>
          )}
          <button className="btn" disabled={busy} onClick={later}>
            Later
          </button>
        </>
      )}
    </div>
  );
}
