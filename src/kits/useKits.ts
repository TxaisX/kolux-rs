// T-543: the window's starter-kit state, moved out of App.tsx as it was. Two hooks, called where the
// code used to sit: useKits holds the gallery and setup dialogs and the runs started in this window
// (the window's state slot), useKitRun reads the shown workspace's run and acts on its seats (the
// slot where the kit strip's check was). Starting a kit and its samples stay in the window: they
// open panes and workspaces through code declared after the state slot.
import { useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Pane } from "../App";
import type { AgentInfo } from "../launch/PlusMenu";
import type { AgentState } from "../projects/rows";
import type { TurnInfo } from "../status/useAgentStatus";
import { OPEN_KITS } from "./Kits";
import { noteResults } from "./milestones";
import { KITS, readyVendors, type Vendor } from "./catalog";
import { useKitCheck } from "./KitStrip";
import { datedName, matchSeats, previewKind, roleDone, seatTitle, type Past } from "./run";
import { cellsOf, columnsFor, groupOf, insertBefore, MAX_PANES, splitIndex } from "../terminal/grid";
import { panesIn } from "../workspaces";

/** SKILL-008: a seat waiting for the role it depends on. */
export type KitWait = { role: string; upstream: string; key: number; prompt: string };
/** A kit run started in this window; `prompts` are each role's first message, kept for Restart and Move to (SKILL-011). */
export type KitRun = { started: number; seats: (number | null)[] | null; waiting: KitWait[]; sent: Record<string, number>; prompts: string[] };
/** Which kit AI a pane runs, from its mark or, for Grok, its program. */
export const aiOf = (p: { agent: string; program: string | null }): string | null => (p.agent === "claude" || p.agent === "codex" ? p.agent : /grok/i.test(p.program ?? "") ? "grok" : null);

export function useKits(agents: AgentInfo[]) {
  // SKILL-002: the kit gallery and a kit's setup float over every screen; any part of the app opens
  // the gallery with the kolux-open-kits event.
  const [kits, setKits] = useState<{ kit: string | null; sampleDir: string | null } | null>(null);
  const [samplesBusy, setSamplesBusy] = useState(false);
  const [kitConflict, setKitConflict] = useState<string | null>(null);
  // SKILL-006 / SKILL-008: each folder's kit run in this window: its start, the seats in role order
  // (null when not every seat started), the roles still waiting and when each waiting one was sent.
  const kitRuns = useRef<Record<string, KitRun>>({});
  const [kitTick, setKitTick] = useState(0);
  const [kitFolded, setKitFolded] = useState(false);
  // SKILL-014: the recent kit runs the gallery lists, read each time it opens.
  const [kitRecent, setKitRecent] = useState<Past[]>([]);
  const galleryOpen = kits !== null && kits.kit === null;
  useEffect(() => {
    if (galleryOpen) invoke<Past[]>("kit_history").then(setKitRecent, () => setKitRecent([]));
  }, [galleryOpen]);
  // SESS-019: a chooser's Set up kit names the kit and the chooser, which closes once the kit starts.
  const chooserSetup = useRef<number | null>(null);
  useEffect(() => {
    const show = (e: Event) => {
      const from = (e as CustomEvent<{ kit: string; chooser?: number } | undefined>).detail;
      if (!from) return setKits((k) => k ?? { kit: null, sampleDir: null });
      chooserSetup.current = from.chooser ?? null;
      pickKit(from.kit);
    };
    window.addEventListener(OPEN_KITS, show);
    return () => window.removeEventListener(OPEN_KITS, show);
  }, []);
  // SKILL-003: Claude, Codex and Grok, when found and not switched off, can take kit roles.
  // ONB-005 / SKILL-003: `agents` is already the switched-on set, so a kit never counts or casts an AI turned off on the Agents page.
  const kitAIs = useMemo(() => readyVendors(agents), [agents]);
  const pickKit = (id: string) => {
    setKitConflict(null);
    setKits({ kit: id, sampleDir: null });
    invoke<string>("kit_samples_dir", { kit: id }).then((d) => setKits((k) => (k?.kit === id ? { ...k, sampleDir: d } : k)), () => {});
  };
  return { kits, setKits, samplesBusy, setSamplesBusy, kitConflict, setKitConflict, kitRuns, kitTick, setKitTick, kitFolded, setKitFolded, kitRecent, chooserSetup, kitAIs, pickKit };
}

type RunDeps = {
  activeDir: string | null;
  kitFolded: boolean;
  kitTick: number;
  setKitTick: Dispatch<SetStateAction<number>>;
  kitRuns: MutableRefObject<Record<string, KitRun>>;
  panes: Pane[];
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  setFocused: Dispatch<SetStateAction<number>>;
  nextKey: MutableRefObject<number>;
  setToast: (text: string) => void;
  hook: Record<number, AgentState>;
  turn: Record<number, TurnInfo>;
  agents: AgentInfo[];
  startIn: (agent: AgentInfo, dir: string, branch: string | null, prompt: string, show: boolean, extra?: string[], title?: string) => Promise<number | null>;
};

export function useKitRun({ activeDir, kitFolded, kitTick, setKitTick, kitRuns, panes, setPanes, setFocused, nextKey, setToast, hook, turn, agents, startIn }: RunDeps) {
  // SKILL-009 / SKILL-010: the shown workspace's kit run and its seats.
  const [kitCheck] = useKitCheck(activeDir, kitFolded, kitTick);
  const kitSeats = kitCheck && activeDir !== null
    ? matchSeats(
        kitCheck.record,
        kitRuns.current[activeDir]?.started === kitCheck.record.started ? kitRuns.current[activeDir].seats : null,
        panesIn(panes, activeDir).filter((p) => !p.kind).map((p) => ({ key: p.key, ai: aiOf(p) })),
      )
    : [];
  // SKILL-013: Collect results copies every role's declared files into one dated folder.
  const kitCollect = async () => {
    if (!activeDir || !kitCheck) return;
    const kit = KITS.find((k) => k.id === kitCheck.record.kit);
    if (!kit) return setToast("Kolux does not know this kit any more, so it cannot collect its results.");
    const roles = kit.roles.map((r) => ({ id: r.id, title: r.title, files: r.delivers }));
    try {
      const got = await invoke<{ folder: string; copied: string[]; missing: string[] }>("kit_collect", { dir: activeDir, roles, name: datedName(kit.title, Date.now()) });
      const miss = got.missing.length ? ` ${got.missing.length} ${got.missing.length === 1 ? "file was" : "files were"} not there: ${got.missing.join(", ")}.` : "";
      void noteResults(); // SKILL-016: collected results count as the first results seen.
      setToast(`Collected ${got.copied.length} ${got.copied.length === 1 ? "file" : "files"} into kit-results\\${got.folder}, with a README and a Results page.${miss}`);
    } catch (err) {
      setToast(`Kolux could not collect the results this time: ${String(err)}`);
    }
  };
  // SKILL-012: Preview shows a result beside the role's session, in a split of its own that the
  // next preview uses again; it never replaces the AI's tab.
  const kitPreview = (i: number, file: string) => {
    const role = kitCheck?.record.roles[i];
    if (!activeDir || !role) return;
    const path = `${activeDir.replace(/[\\/]+$/, "")}\\kit-results\\${role.id}\\${file}`;
    const here = panesIn(panes, activeDir);
    const old = here.find((p) => p.kitPreview);
    const pane: Pane = { key: nextKey.current++, cwd: activeDir, branch: here[0]?.branch ?? null, agent: "shell", program: null, args: [], kind: previewKind(file), path, kitPreview: true };
    if (old) {
      setPanes((ps) => ps.map((p) => (p.key === old.key ? { ...pane, group: groupOf(old) } : p)));
    } else {
      const shown = cellsOf(here);
      if (shown.length >= MAX_PANES) return setToast(`A workspace holds up to ${MAX_PANES} panes; close one to preview ${file}.`);
      const seat = panes.find((p) => p.key === kitSeats[i]);
      const at = seat ? splitIndex(shown.map((c) => c.group), groupOf(seat), "right", columnsFor(shown.length + 1, false)) : shown.length;
      setPanes(insertBefore(panes, shown[at]?.panes[0], pane));
    }
    setFocused(pane.key);
    void noteResults(); // SKILL-016: a previewed result counts as results opened.
  };
  const kitOpenFile = (i: number, file: string) => {
    const role = kitCheck?.record.roles[i];
    if (activeDir && role)
      invoke("kit_open_file", { dir: activeDir, role: role.id, file }).then(
        () => void noteResults(), // SKILL-016: an opened result file counts as results opened.
        (err) => setToast(`Kolux could not open ${file}: ${String(err)}`),
      );
  };
  // SKILL-011: Restart and Move to start one seat for the role on the chosen AI and make it the
  // role's session; with the settings unreadable nothing starts.
  /** SKILL-011: why a kit seat's hooks say it is stopped, while it is. */
  const kitStop = (k: number) => {
    const cause = hook[k] === "blocked" ? turn[k]?.stop?.cause : undefined;
    return cause === "limit" || cause === "signin" ? cause : null;
  };
  const kitRestart = async (i: number, ai: string) => {
    const dir = activeDir;
    const check = kitCheck;
    const kit = check && KITS.find((k) => k.id === check.record.kit);
    const role = kit?.roles[i];
    if (!dir || !check || !kit || !role) return;
    try {
      await invoke("get_settings");
    } catch (err) {
      return setToast(`Nothing started: Kolux could not read its settings (${String(err)}).`);
    }
    const agent = agents.find((x) => x.id === ai && x.installed);
    if (!agent) return setToast(`${ai} is not installed, so the ${role.title} role cannot start there.`);
    const run = kitRuns.current[dir];
    const prompt = run?.started === check.record.started ? run.prompts[i] : undefined;
    if (!run || prompt === undefined) return setToast("Kolux no longer holds this run's inputs; start the kit again from Starter kits.");
    const waits = !!role.waitsFor && !roleDone(check, role.waitsFor);
    const key = await startIn(agent, dir, panesIn(panes, dir)[0]?.branch ?? null, waits ? "" : prompt, true, [], seatTitle(role, agent.id as Vendor));
    if (key === null) return;
    run.seats = (run.seats ?? kitSeats).map((k, n) => (n === i ? key : k));
    run.waiting = run.waiting.filter((w) => w.role !== role.id);
    if (waits && role.waitsFor) run.waiting.push({ role: role.id, upstream: role.waitsFor, key, prompt });
    else run.sent[role.id] = Date.now();
    setKitTick((n) => n + 1);
  };
  return { kitCheck, kitSeats, kitCollect, kitPreview, kitOpenFile, kitStop, kitRestart };
}
