// ONB-014 Setup Guide, ONB-022 Explore Kolux and ONB-027 / ONB-028 startup tips. Mounted once in
// the window; the help menu and the tips open the guides through openGuide / openExplore.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Close, EyeOff } from "../chrome/icons";
import { useKeymap } from "../keys/KeymapContext";
import { defaultsOnly, labelOf } from "../keys/keymap";
import "./onboarding.css";
import { useSettings } from "../settings/useSettings";
import Tours from "./Tours";
import { defaultAgentId } from "../launch/agents";
import {
  caps, demoFrames, doneFrom, paletteKeys, doneId, firstOpen, forward, latest, markGuide, moveOn, nextTip, OPEN_EXPLORE, OPEN_GUIDE, PAGE_SHOWN, railKey, ring, startTicked, STEPS, stopDone, stopOf, TWO_REPOS, withRecord, words, workflowDone, WORKFLOWS,
  type At, type Cap, type CapId, type CliStatus, type Facts, type GuideRecord, type Place, type Setup, type StepId, type TipId,
} from "./guide";

type Scan = { skills: { name: string; source: string }[] };

type Read = Omit<Facts, "cli">;
const UNREAD: Read = { workspaces: null, gitProjects: null, pageShown: false, integrations: null, notifications: null, agent: null, setupScript: null };

/** ONB-015: reads what each step stands for. A project counts as git when its workspace list
 *  reads; the lasting count of git projects is kept on the profile once it reaches two. */
async function readFacts(check: ReturnType<typeof latest<boolean>>, put: (f: Partial<Read>) => void, alive: () => boolean) {
  const [settings, g] = await Promise.all([invoke<Record<string, unknown>>("get_settings").catch(() => null), invoke<GuideRecord>("guide_get").catch(() => null)]);
  if (!alive()) return;
  put({ notifications: settings ? settings.notifyOnFinish !== false : null, agent: settings ? defaultAgentId(settings) : null, pageShown: !!g?.tried.includes(PAGE_SHOWN) });
  put({ integrations: "checking" });
  invoke<string | null>("scm_gh_account", { host: "github.com" }).then(
    (login) => alive() && put({ integrations: login ? "connected" : "none" }),
    () => alive() && put({ integrations: null }),
  );
  const projects = await invoke<{ path: string; id: string }[]>("project_list").catch(() => null);
  if (!alive() || !projects) return;
  const lists = await Promise.all(projects.map((p) => invoke<Place[]>("workspace_list", { projectId: p.id }).catch(() => null)));
  if (!alive()) return;
  const git = projects.filter((_, i) => lists[i] !== null);
  const twoBefore = !!g?.tried.includes(TWO_REPOS);
  if (git.length >= 2 && !twoBefore) markGuide("tried", TWO_REPOS).catch(() => {});
  put({ workspaces: lists.filter((l): l is Place[] => l !== null), gitProjects: Math.max(git.length, twoBefore ? 2 : 0) });
  const ticket = check.begin();
  const found = await Promise.all(git.map((p) => invoke<unknown>("workspace_setup", { path: p.path }).then((l) => l !== null, () => false)));
  check.settle(ticket, found.some(Boolean));
}

/** What the guide can tell is done on this computer (ONB-015), read each time the guide opens and
 *  on Re-check. `refresh` reads it again. */
export function useGuideState(on: boolean) {
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [home, setHome] = useState<string[]>([]);
  const [read, setRead] = useState<Read>(UNREAD);
  const [n, setN] = useState(0);
  const check = useRef(latest<boolean>((v) => setRead((r) => ({ ...r, setupScript: v })))).current;
  useEffect(() => {
    if (!on) return;
    let live = true;
    invoke<CliStatus>("cli_status").then((c) => live && setCli(c), () => live && setCli(null));
    invoke<Scan>("skills_scan", { workspace: null, refresh: n > 0 }).then(
      (s) => live && setHome(s.skills.filter((k) => k.source === "home").map((k) => k.name)),
      () => {},
    );
    void readFacts(check, (f) => setRead((r) => ({ ...r, ...f })), () => live);
    return () => void (live = false);
  }, [on, n, check]);
  const list = caps(cli, home);
  const done = doneFrom({ ...read, cli: list.every((c) => c.ready) });
  return { cli, caps: list, done, refresh: () => setN((x) => x + 1) };
}

/** The progress ring: core steps done out of all of them. */
export function Ring({ done, total, size = 40 }: { done: number; total: number; size?: number }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  return (
    <svg className="guide-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${done} of ${total} done`}>
      <circle cx={size / 2} cy={size / 2} r={r} className="track" />
      <circle cx={size / 2} cy={size / 2} r={r} className="fill" strokeDasharray={c} strokeDashoffset={c * (1 - done / Math.max(1, total))} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

function CliStep({ list, onCheck }: { list: Cap[]; onCheck: () => void }) {
  const [ticked, setTicked] = useState<CapId[]>(() => startTicked(list));
  const key = list.map((c) => `${c.id}:${c.ready}`).join();
  useEffect(() => setTicked(startTicked(list)), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <p className="guide-note">
        Registering the CLI puts the <code>kolux</code> command in every terminal on this computer, not only inside Kolux, so an agent you start anywhere can open
        terminals, start other agents and read Kolux's skills.
      </p>
      <ul className="guide-caps">
        {list.map((c) => (
          <li key={c.id}>
            <label>
              <input type="checkbox" checked={ticked.includes(c.id)} onChange={(e) => setTicked(e.target.checked ? [...ticked, c.id] : ticked.filter((t) => t !== c.id))} />
              <span className="name">{c.label}</span>
              <span className={`state${c.ready ? " ok" : ""}`}>{c.ready ? "Ready" : "Not set up"}</span>
            </label>
            <span className="about">{c.about}</span>
          </li>
        ))}
      </ul>
      <p className="guide-note dim">Kolux cannot run this setup for you yet; it arrives with the installer in a coming build. Re-check once you have set these up.</p>
      <div className="btn-row">
        <button className="btn" onClick={onCheck}>
          Re-check
        </button>
      </div>
    </>
  );
}

/** Keeps a dialog's content on screen through its closing fade; opening again during the fade
 *  cancels the teardown. */
function useClosing(open: boolean): boolean {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) return setShown(true);
    const t = window.setTimeout(() => setShown(false), 160);
    return () => window.clearTimeout(t);
  }, [open]);
  return shown;
}

function SetupGuide({ ask, open, onClose }: { ask: StepId | null; open: boolean; onClose: () => void }) {
  const g = useGuideState(open);
  const { save } = useSettings();
  const [at, setAt] = useState<StepId>(() => firstOpen(g.done, ask));
  const doneKey = [...g.done].join();
  useEffect(() => {
    if (open) setAt(firstOpen(g.done, ask));
  }, [open, ask]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setAt((a) => moveOn(a, g.done)), [doneKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useClosing(open);
  if (!shown) return null;
  const r = ring(g.done);
  const step = STEPS.find((s) => s.id === at)!;
  const row = (s: (typeof STEPS)[number], n?: number) => (
    <button key={s.id} className={`guide-step${s.id === at ? " on" : ""}${g.done.has(s.id) ? " done" : ""}`} aria-current={s.id === at} onClick={() => setAt(s.id)}>
      <span className="tick">{g.done.has(s.id) ? "✓" : n ?? ""}</span>
      <span className="name">{words(s).name}</span>
      {!s.core && <span className="opt">Optional</span>}
    </button>
  );
  return (
    <div className={`ask-backdrop${open ? "" : " closing"}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="guide" role="dialog" aria-modal="true" aria-label="Getting Started with Kolux" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <aside className="guide-side">
          <header className="guide-head">
            <Ring done={r.done} total={r.total} />
            <div>
              <h2>Getting Started</h2>
              <p>
                {r.done} of {r.total} done
              </p>
            </div>
            <span className="spacer" />
            <button className="ib" title="Remove the checklist from the sidebar" onClick={() => void save({ setupChecklist: false })}>
              <EyeOff />
            </button>
          </header>
          <p className="guide-group">Setup</p>
          {STEPS.filter((s) => s.group === "setup").map((s) => row(s))}
          <p className="guide-group">Parallel work</p>
          {STEPS.filter((s) => s.group === "parallel").map((s, i) => row(s, i + 1))}
        </aside>
        <section className="guide-panel">
          <header>
            <h3>{words(step).name}</h3>
            <button className="ib" title="Close (Escape)" onClick={onClose} autoFocus>
              <Close />
            </button>
          </header>
          <p>{words(step).about}</p>
          {step.id === "cli" && <CliStep list={g.caps} onCheck={g.refresh} />}
          {g.done.has(step.id) && <p className="guide-done">Done</p>}
        </section>
      </div>
    </div>
  );
}

function Explore({ onClose }: { onClose: () => void }) {
  const [at, setAt] = useState<At>({ w: 0, s: -1 });
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [setup, setSetup] = useState<Setup>({ taskSource: false, skills: [] });
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Merged, not replaced: a stop visited before the record arrived stays seen (FIX-1).
    invoke<GuideRecord>("guide_get").then((g) => (setSeen((s) => withRecord(s, new Set(), g).seen), setKept((k) => withRecord(new Set(), k, g).kept)), () => {});
    // ONB-023: the setup a stop carries, read when the tour opens.
    invoke<string | null>("scm_gh_account", { host: "github.com" }).then((l) => setSetup((s) => ({ ...s, taskSource: !!l })), () => {});
    invoke<Scan>("skills_scan", { workspace: null, refresh: false }).then((r) => setSetup((s) => ({ ...s, skills: r.skills.filter((k) => k.source === "home").map((k) => k.name) })), () => {});
  }, []);
  const stop = stopOf(at);
  useEffect(() => {
    setSeen((s) => new Set(s).add(stop.id));
    markGuide("visited", stop.id).catch(() => {});
  }, [stop.id]);
  // ONB-023: a stop that is complete is kept complete on the profile, whatever detection says later.
  const isDone = (id: string) => stopDone(id, seen, setup, kept);
  const newlyDone = WORKFLOWS.flatMap((w) => [w.id, ...w.stops.map((s) => s.id)]).filter((id) => !kept.has(doneId(id)) && isDone(id));
  const doneKey = newlyDone.join();
  useEffect(() => {
    for (const id of newlyDone) markGuide("tried", doneId(id)).catch(() => {});
    if (newlyDone.length) setKept((k) => new Set([...k, ...newlyDone.map(doneId)]));
  }, [doneKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = forward(at);
  const go = () => (next ? setAt(next) : onClose());
  const wf = WORKFLOWS[at.w];
  return (
    <div className="ask-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="explore"
        role="dialog"
        aria-modal="true"
        aria-label="Explore Kolux"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            go();
          }
        }}
      >
        <div className="explore-rail" role="tablist" aria-orientation="vertical" ref={rail}>
          <p className="guide-group">A short walk through Kolux, one workflow at a time</p>
          {WORKFLOWS.map((w, i) => (
            <button
              key={w.id}
              role="tab"
              aria-selected={i === at.w}
              tabIndex={i === at.w ? 0 : -1}
              className={`explore-wf${i === at.w ? " on" : ""}`}
              onClick={() => setAt({ w: i, s: -1 })}
              onKeyDown={(e) => {
                const to = railKey(e.key, at.w);
                if (to === null) return;
                e.preventDefault();
                setAt({ w: to, s: -1 });
                (rail.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[to])?.focus();
              }}
            >
              <span className="name">{w.title}</span>
              {workflowDone(w, seen, setup, kept) && <span className="mark ok">Completed</span>}
            </button>
          ))}
        </div>
        <section className="explore-main" role="tabpanel">
          <header>
            <span className="spacer" />
            <button className="ib" title="Close (Escape)" onClick={onClose}>
              <Close />
            </button>
          </header>
          <div className={`explore-pic pic-${wf.id}`} aria-hidden="true">
            <span>{wf.title}</span>
          </div>
          {wf.stops.length > 0 && (
            <div className="explore-stops">
              {wf.stops.map((s, i) => (
                <button key={s.id} className={`chip${at.s === i ? " on" : ""}`} onClick={() => setAt({ w: at.w, s: i })}>
                  {s.title}
                  {s.optional && <span className="opt">Optional</span>}
                  {isDone(s.id) && <span className="mark ok">✓</span>}
                </button>
              ))}
            </div>
          )}
          <h3>{stop.title}</h3>
          <p>{stop.caption}</p>
          <div className="btn-row">
            <span className="spacer" />
            <span className="hint">
              <span className="kbd">Ctrl</span>+<span className="kbd">Enter</span>
            </span>
            <button className="btn primary" onClick={go}>
              {next ? "Continue" : "Done"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

/** ONB-029: the palette's key chips, following the user's binding; the default when unassigned. */
function PaletteKeys() {
  const map = useKeymap();
  const parts = paletteKeys(labelOf(map, "worktree.palette"), labelOf(defaultsOnly(map.platform), "worktree.palette"));
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} className="kbd-part">
          {i > 0 && <span className="kbd-plus">+</span>}
          <span className="kbd">{p}</span>
        </span>
      ))}
    </>
  );
}

/** ONB-029: a short demo of typing into the palette that brings up a create-workspace row. It plays
 *  once and stops; with reduced motion it shows the end state and runs no timer. */
function PaletteDemo() {
  const reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const frames = useRef(demoFrames(reduced)).current;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (i >= frames.length - 1) return;
    const t = window.setTimeout(() => setI(i + 1), i === 0 ? 600 : 110);
    return () => window.clearTimeout(t);
  }, [i, frames.length]);
  const f = frames[i];
  return (
    <div className="onb-demo" aria-hidden>
      <div className="onb-demo-input">
        {f.typed}
        <span className="caret" />
      </div>
      {f.create && <div className="onb-demo-row">Create workspace “{f.typed}”</div>}
    </div>
  );
}

/** ONB-027: at most one tip per launch, once settings, onboarding and the CLI status are known and
 *  no other dialog is open. A tip counts as seen the moment it appears. */
function StartupTip() {
  const [tip, setTip] = useState<TipId | null>(null);
  const [cli, setCli] = useState<CliStatus | null>(null);
  useEffect(() => {
    let live = true;
    let timer = 0;
    Promise.all([
      invoke<unknown>("onboarding_get"),
      invoke<GuideRecord>("guide_get"),
      invoke<CliStatus>("cli_status").catch(() => "error" as const),
      invoke("get_settings"),
    ]).then(([onb, g, c]) => {
      const t = nextTip({ seen: g.tipsSeen, tried: g.tried, cli: c, onboarding: onb !== null });
      if (!t) return;
      const show = () => {
        if (!live) return;
        if (document.querySelector("[role=dialog]")) return void (timer = window.setTimeout(show, 1000));
        markGuide("tipsSeen", t).catch(() => {});
        if (c !== "error") setCli(c);
        setTip(t);
      };
      show();
    }, () => {});
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, []);
  if (!tip) return null;
  const close = () => setTip(null);
  return (
    <div className="ask-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="tip" role="dialog" aria-modal="true" aria-label="Tip" onKeyDown={(e) => e.key === "Escape" && close()}>
        <span className="tip-badge">Tip</span>
        {tip === "cli" ? (
          <>
            <h3>Let your agents drive Kolux</h3>
            <ul>
              <li>Open terminals and type into them from any agent</li>
              <li>Start other agents, hand them work and wait for their results</li>
              <li>Teach every agent Kolux's commands through its skills</li>
            </ul>
            {cli?.installed && !cli.onPath && <p className="tip-warn">Needs attention: the kolux command is installed, but terminals outside Kolux cannot find it.</p>}
            <div className="btn-row">
              <button className="btn" onClick={close} autoFocus>
                Not now
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  close();
                  window.dispatchEvent(new CustomEvent(OPEN_GUIDE, { detail: "cli" }));
                }}
              >
                Install CLI &amp; Skills
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>
              Jump to any workspace with <PaletteKeys />
            </h3>
            <PaletteDemo />
            <p>Type part of a name to switch, or a new name to create a workspace. Change the keys in Settings › Shortcuts.</p>
            <div className="btn-row">
              <span className="spacer" />
              <button className="btn primary" onClick={close} autoFocus>
                Got it
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The window's guides: one mount line in App.tsx. */
export default function Guides() {
  const [guide, setGuide] = useState<{ open: boolean; ask: StepId | null }>({ open: false, ask: null });
  const [explore, setExplore] = useState(false);
  useEffect(() => {
    const g = (e: Event) => setGuide({ open: true, ask: (e as CustomEvent<StepId | null>).detail });
    const x = () => setExplore(true);
    window.addEventListener(OPEN_GUIDE, g);
    window.addEventListener(OPEN_EXPLORE, x);
    return () => {
      window.removeEventListener(OPEN_GUIDE, g);
      window.removeEventListener(OPEN_EXPLORE, x);
    };
  }, []);
  return (
    <>
      <SetupGuide open={guide.open} ask={guide.ask} onClose={() => setGuide((g) => ({ ...g, open: false }))} />
      {explore && <Explore onClose={() => setExplore(false)} />}
      <StartupTip />
      <Tours />
    </>
  );
}
