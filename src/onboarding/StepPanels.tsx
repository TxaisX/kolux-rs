// ONB-016 / ONB-018: the action panel of a selected Setup Guide step. Multi-task opens the
// new-workspace composer with a short tour, notifications offers sound choices (and on macOS a
// permission card), the default-agent step shows an agent picker with a fold-out list of fallback
// agents, and the setup-script step offers to automate workspace setup. The rules are in actions.ts.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../settings/useSettings";
import { playTone, readNotifications, SOUND_FIELD, testPlan, VOLUME_FIELD, type Sound } from "../settings/notifications";
import { DEFAULT_AGENT_KEY } from "../launch/agents";
import type { AgentInfo } from "../launch/PlusMenu";
import {
  agentPanel, CARD_WORDS, composeTarget, composerRequests, foldLabel, permissionCard, platformOf, soundPanel,
  type Hands, type Proj,
} from "./actions";
import { markGuide, type GuideRecord, type Place } from "./guide";
import { replayTour } from "./tour";

/** The first copy of `sel` that is really on screen. */
function shown(sel: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

const domHands: Hands = {
  click: (sel) => {
    const el = shown(sel);
    if (!el) return false;
    if (el.getAttribute("aria-pressed") !== "true") el.click();
    return true;
  },
  onScreen: () => !!shown(".sb-list"),
  wait: (ms) => new Promise((r) => window.setTimeout(r, ms)),
};

/** The window's one composer-request queue: the guide opening or closing voids what is waiting. */
export const composer = composerRequests(domHands);

export function MultitaskPanel({ close }: { close: () => void }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const projects = await invoke<Proj[]>("project_list");
      const lists = await Promise.all(projects.map((p) => invoke<Place[]>("workspace_list", { projectId: p.id }).catch(() => null)));
      const active = document.querySelector<HTMLElement>(".sess.sel")?.closest<HTMLElement>("[data-path]")?.dataset.path ?? null;
      const target = composeTarget(projects, lists, active);
      if (target.kind === "ask") return setAsk(true);
      composer.reset();
      close();
      if ((await composer.open(target)) === "opened") replayTour("create");
    } catch {
      setAsk(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="guide-note">A workspace is a copy of your project in its own folder, so a second agent never collides with the first.</p>
      {ask && (
        <p className="guide-note" role="status">
          Multi-task needs a git project. Add a folder that is a git repository, then come back.{" "}
          <button
            className="btn"
            onClick={() => {
              composer.reset();
              close();
              void composer.open({ kind: "ask" });
            }}
          >
            Add a project
          </button>
        </p>
      )}
      <div className="btn-row">
        <button className="btn primary" onClick={() => void go()} disabled={busy}>
          Create a workspace
        </button>
      </div>
    </>
  );
}

export function NotificationsPanel() {
  const { settings, save } = useSettings();
  const [result, setResult] = useState<{ shown: boolean; blocked: boolean } | { error: string } | null>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    invoke<GuideRecord>("guide_get").then((g) => setAsked(g.tried.includes("notify-asked")), () => {});
  }, []);
  if (!settings) return null;
  const n = readNotifications(settings);
  const panel = soundPanel(n.sound);
  const test = async () => {
    const plan = testPlan(n);
    try {
      const r = await invoke<{ shown: boolean; blocked: boolean }>("notification_test", { sound: plan.toastSound });
      setResult(r);
      if (r.shown && plan.tone) playTone(plan.tone, plan.gain);
      if (r.blocked && !asked) {
        setAsked(true);
        void markGuide("tried", "notify-asked").catch(() => {});
      }
    } catch (e) {
      setResult({ error: String(e) });
    }
  };
  const card = permissionCard(platformOf(navigator.userAgent), result && !("error" in result) ? result : null, asked);
  return (
    <>
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={n.kinds.notifyOnFinish} onChange={(e) => void save({ notifyOnFinish: e.target.checked })} />
        Tell me when an agent finishes or needs me
      </label>
      <div className="look-select">
        <span>Sound</span>
        <select aria-label="Notification sound" value={n.sound} onChange={(e) => void save({ [SOUND_FIELD]: e.target.value as Sound })}>
          {panel.choices.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {panel.slider && (
        <div className="look-select">
          <span>Volume</span>
          <input type="range" min={0} max={100} step={5} aria-label="Volume" value={n.volume} onChange={(e) => void save({ [VOLUME_FIELD]: Number(e.target.value) })} />
        </div>
      )}
      {card.show && (
        <p className={`guide-note${card.state === "blocked" ? " warn" : ""}`} role="status" data-permission={card.state}>
          {CARD_WORDS[card.state]}
        </p>
      )}
      {result && "error" in result && <p className="guide-note warn">The test notification could not be shown: {result.error}</p>}
      <div className="btn-row">
        <button className="btn" onClick={() => void test()}>
          Send a test notification
        </button>
      </div>
    </>
  );
}

export function AgentPanel() {
  const { settings, save } = useSettings();
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    invoke<AgentInfo[]>("agent_list").then(setAgents, () => setAgents([]));
  }, []);
  if (!settings || !agents) return null;
  const p = agentPanel(agents, settings);
  const row = (a: AgentInfo) => (
    <label key={a.id} className="conn-switch">
      <input type="radio" name="default-agent" checked={p.current === a.id} onChange={() => void save({ [DEFAULT_AGENT_KEY]: a.id })} />
      {a.name}
    </label>
  );
  if (p.picker.length === 0 && p.fallback.length === 0) return <p className="guide-note">No agent is installed yet. Install Claude Code or Codex, then check again.</p>;
  return (
    <>
      <div role="radiogroup" aria-label="Default agent">
        {p.picker.map(row)}
      </div>
      {p.fallback.length > 0 && (
        <>
          <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {foldLabel(open)}
          </button>
          {open && <div role="radiogroup" aria-label="Fallback agents">{p.fallback.map(row)}</div>}
        </>
      )}
    </>
  );
}

const SNIPPET = "scripts:\n  setup: pnpm install\n";

export function AutomatePanel({ onCheck }: { onCheck: () => void }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const box = useRef<HTMLPreElement>(null);
  const copy = () =>
    navigator.clipboard.writeText(SNIPPET).then(
      () => setCopied(true),
      () => {
        setCopied(false);
        const sel = window.getSelection();
        if (box.current && sel) sel.selectAllChildren(box.current);
      },
    );
  return (
    <>
      <p className="guide-note">
        Put a setup script in a file called <code>kolux.yaml</code> at the top of your repository. Every new workspace runs it before an agent starts.
      </p>
      <pre ref={box} className="guide-code">{SNIPPET}</pre>
      <div className="btn-row">
        <button className="btn" onClick={() => void copy()}>
          Copy the example
        </button>
        <button className="btn" onClick={onCheck}>
          Re-check
        </button>
        {copied === true && <span className="hint">Copied</span>}
        {copied === false && <span className="hint">Copy failed; the example is selected, press Ctrl+C</span>}
      </div>
    </>
  );
}

