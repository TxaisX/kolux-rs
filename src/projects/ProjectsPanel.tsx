// The sidebar card (design/DESIGN.md section 5): Tasks and Artifacts rows, the Projects header
// with its icon row, Workspaces / Status tabs, then each project with its main checkout and
// workspaces, "Next that needs you", "New session" and the footer row. The working parts are
// T-003's: add a Git folder as a project (type or browse), set where workspace folders live,
// create a workspace (a new branch in its own folder), open a shell in one, remove one again.
// Every action goes to the Rust side; this file only draws the state it gets back.
// T-013: adding a project opens its main checkout (PROJ-007); Mod+N or the header's plus opens
// the name field for the project in front, a stand-in row shows while Git works, and the new
// workspace opens with a shell of its own unless the user moved on meanwhile (PROJ-020).
// T-014-a: the name field also takes a start ref, an agent and a first prompt (PROJ-028,
// PROJ-038); the footer gear sets the global workspaces folder and layout, a project's own gear
// its folder and base ref (PROJ-025).
// T-077: a child workspace sits indented under the one it was made from and folds with it; the
// gear's checkbox switches nesting off (PROJ-047). Folding hides child rows only; the agent summary
// a card can show (PROJ-062, T-266) must stay open when its parent folds, and is built there.
// ponytail: which rows are folded lasts until the window closes; nothing saves it.
// T-022: rows carry the strongest live agent state and an unread mark (PROJ-063), the list can be
// grouped by project, status or pull request and sorted Smart or by name (PROJ-045, PROJ-050).
import { useCallback, useEffect, useRef, useState } from "react";
import { blocker, deleteTarget, shownChanges, skipsQuestion, type RemoveCheck } from "./deleting";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { GROUP_SETTING, SORT_SETTING, groupFromSetting, groupRows, smartOrder, sortFromSetting, type AgentState, type RowInfo } from "./rows";
import { pushBadge, type Pushed } from "../scm/model";
import { afterScan, matchLetters, middle, nestRows, openedWorktree, parentChoices, pathHints, rankProjects, shortcodes, type ProjectMatch, orderWorktrees, relPath, placeFieldAction, previewSentence, worktreeLabel, type Created, type PlaceInfo, type Preview, type Project, type VisSource, type Worktree, createOpens, overtakenBy, prItems, waitsForSetup, workItem, keepOnSwitch, itemLabel, bound, stoppedNote, type Linked, type PendingCreate, type PrHead, type SetupLine, type SetupWhere } from "./model";
import { ArrowRight, Bell, ChevronDown, Close, EyeOff, FileCode, FolderPlus, Gear, Help, List, Plus, Rail, Refresh, Rocket, Sliders, Target, Box } from "../chrome/icons";
import AddProject from "./AddProject";
import Picker, { type PickItem } from "./Picker";
import StartGit, { type FirstFile } from "./StartGit";
import { openKits } from "../kits/Kits";
import PlusMenu, { type AgentInfo } from "../launch/PlusMenu";
import { openSettings as openSettingsPage } from "../settings/pages";
import AutomationsRow from "./AutomationsRow";
import { chromeShown } from "../chrome/chromeItems";
import { VOCAB } from "../terminal/status";
import type { AgentPass } from "../launch/agents";
import { KeyText } from "../keys/KeymapContext";
import { requestUpdateCheck } from "../update/UpdateCenter";
import { GLOSSARY } from "../glossary";
import ImportSetup, { refusedLine, type SetupImport } from "./ImportSetup";

/** The pages that open over the content column from the sidebar footer. */
export type Page = "automations" | "routing";

type Props = {
  /** Folders a pane is open in: those workspace rows show a live dot and a count. */
  openDirs: string[];
  /** PROJ-063: each open folder's strongest agent state and when it last changed. */
  states: Record<string, RowInfo>;
  /** PROJ-063 / TERM-118: workspace paths marked unread, kept by the window; `onUnread` flips one. */
  unread: Set<string>;
  onUnread: (dir: string, unread: boolean) => void;
  /** PROJ-045 / PROJ-050: the remembered group-by and sort choices, saved through `onSetting`. */
  settings: Record<string, unknown>;
  onSetting: (key: string, value: unknown) => void;
  /** The workspace the grid shows (PROJ-066); its row is the selected one. */
  activeDir: string | null;
  /** A click on a row shows that workspace. */
  /** `fresh`: the workspace was just made (TERM-005 seeds its grid). */
  onSelect: (dir: string, branch: string | null, fresh?: boolean) => void;
  /** After a workspace and its folder are gone, so the window drops its panes. */
  onRemoved: (path: string) => void;
  /** The plus menu behind "New session" (T-004): agents found on the PATH, and the launch. */
  agents: AgentInfo[];
  launching: boolean;
  onLaunch: (agent: AgentInfo, projectId: string | null) => void;
  defaultId: string;
  onSetDefault: (id: string) => void;
  onChoose: () => void;
  /** SESS-009: the dropdown's blank-terminal row (a plain shell tab). */
  onTerminal?: () => void;
  /** SESS-003 / SESS-002: every installed agent is off; where the agent search stands. */
  allOff?: boolean;
  pass?: AgentPass;
  onRefresh?: () => void;
  /** DT-17 / AUTO-023: the Automations page is opened from the sidebar's Automations row. */
  /** Which page (Automations, Model routing) is open over the content column, if any. */
  page: Page | null;
  onPage: (page: Page) => void;
  /** Bump to reload the list after something outside the sidebar made a workspace. */
  refresh: number;
  /** Hands the window the project list and which project owns each workspace folder. */
  onIndex: (projects: Project[], owner: Record<string, string>, names: Record<string, string>) => void;
  /** Bumped by Mod+N (workspace.create): opens the name field for the project in front. */
  createRequest: number;
  /** PROJ-057: a name typed in the palette, put in the name field that createRequest opens. */
  createName?: string;
  /** Bumped by Mod+Shift+Backspace (workspace.delete): asks to delete the workspace shown (PROJ-070). */
  deleteRequest: number;
  /** PROJ-038: starts an agent with a first prompt in a workspace just made; `show` brings it in front. */
  onStartIn: (agent: AgentInfo, dir: string, branch: string | null, prompt: string, show: boolean) => Promise<number | null> | void;
  /** PROJ-047: child workspaces nest under their parent unless this is off. */
  nest: boolean;
  onNest: (on: boolean) => void;
  /** SKILL-036: the Artifacts row opens the library and shows as current while it is up. */
  artifactsOn: boolean;
  onArtifacts: () => void;
  /** PROJ-020: the creates Git is still working on, for the stand-in tabs beside the panes. */
  onPending?: (pending: PendingCreate[]) => void;
  /** PROJ-033: open a Setup terminal in a new workspace; `then` runs once it has ended. */
  onSetup?: (dir: string, branch: string | null, line: SetupLine, where: SetupWhere, show: boolean, then?: () => Promise<number | null> | void) => void;
};

// SESS-035: the projects the composer last made workspaces in, newest first (this computer only).
const RECENT_KEY = "kolux.composer.recentProjects";
const ADD_ITEM = "+add";
const readRecent = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};
const noteRecent = (id: string) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 5)));
  } catch {
    // a remembered order is a convenience; without storage the list keeps its own order
  }
};

export default function ProjectsPanel({ openDirs, states, unread, onUnread, settings, onSetting, activeDir, onSelect, onRemoved, agents, launching, onLaunch, defaultId, onSetDefault, onChoose, onTerminal, allOff, pass, onRefresh, page, onPage, refresh, onIndex, createRequest, createName = "", deleteRequest, onStartIn, nest, onNest, artifactsOn, onArtifacts, onPending, onSetup }: Props) {
  const [moving, setMoving] = useState<string | null>(null); // the workspace whose parent picker is open (PROJ-048)
  const [shutKids, setShutKids] = useState<ReadonlySet<string>>(new Set()); // parent workspaces folded shut (PROJ-047)
  const [projects, setProjects] = useState<Project[]>([]);
  const [plusOpen, setPlusOpen] = useState(false);
  const index = useRef(onIndex);
  index.current = onIndex;
  const [worktrees, setWorktrees] = useState<Record<string, Worktree[]>>({}); // the ones the sidebar shows
  const [hiddenWts, setHiddenWts] = useState<Record<string, Worktree[]>>({}); // PROJ-042: hidden by the user
  const [fresh, setFresh] = useState<Record<string, Worktree[]>>({}); // PROJ-041: made outside Kolux, not yet reviewed
  const [pushedBy, setPushedBy] = useState<Record<string, Pushed>>({}); // GIT-065: by worktree path
  const pushTag = (w: Worktree) => {
    const b = pushBadge(pushedBy[w.path]);
    return b && <span className={`hint push ${b.tone}`}>{b.text}</span>;
  };
  const [review, setReview] = useState<string | null>(null); // project id whose new-worktree review is open
  const [hiddenPage, setHiddenPage] = useState(0);
  const [visGlobal, setVisGlobal] = useState<VisSource[]>([]); // SET-032: the global choice per source
  const [visOwn, setVisOwn] = useState<VisSource[]>([]); // PROJ-042: the open project's own, over the global
  const [rootPath, setRootPath] = useState("");
  const [rootError, setRootError] = useState("");
  const [place, setPlace] = useState<PlaceInfo>({ dir: "", flat: false, used: [], fromEnv: false });
  const [rootDraft, setRootDraft] = useState("");
  const [flatDraft, setFlatDraft] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null); // project id whose folder / base form is open
  const [dirDraft, setDirDraft] = useState("");
  const [projectBaseDraft, setProjectBaseDraft] = useState("");
  const [baseDraft, setBaseDraft] = useState(""); // PROJ-028: the start ref for the workspace being made
  const [agentDraft, setAgentDraft] = useState(""); // PROJ-038: agent id, "" for a shell
  const [promptDraft, setPromptDraft] = useState("");
  const [pathDraft, setPathDraft] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  // PROJ-002: the Add Project dialog, from the folder button or the composer's Add project item.
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState<string | null>(null); // project id whose name field is open; "" with no project yet
  const [pending, setPendingList] = useState<PendingCreate[]>([]); // the stand-in rows while Git works
  const pendingNow = useRef<PendingCreate[]>([]);
  const setPending = (next: PendingCreate[]) => {
    pendingNow.current = next;
    setPendingList(next);
    onPending?.(next);
  };
  const tickets = useRef(Date.now()); // PROJ-020: one ticket per create, never reused in a session
  const overtaken = useRef(new Set<number>());
  const [stopping, setStopping] = useState<number[]>([]); // SESS-038: creates the user cancelled mid-submit
  const stopped = useRef(new Set<number>());
  const stopCreate = (ticket: number) => {
    stopped.current.add(ticket);
    setStopping((s) => [...s, ticket]);
    invoke("workspace_create_cancel", { ticket }).catch(() => {});
  };
  const shown = useRef(activeDir); // the workspace in front, read when a create finishes
  shown.current = activeDir;
  const [name, setName] = useState("");
  const [existing, setExisting] = useState(false); // PROJ-030: open a branch that already exists instead of making one
  const [branchList, setBranchList] = useState<string[]>([]);
  const [prList, setPrList] = useState<PrHead[] | null>(null); // PROJ-030: the open pull requests, null when not opening one
  const [prDraft, setPrDraft] = useState<PrHead | null>(null);
  const [branchDraft, setBranchDraft] = useState(""); // SESS-037: Advanced branch name (the branch to reuse with existing)
  const [parentDraft, setParentDraft] = useState<string | null>(null); // SESS-037: the parent worktree, none by default
  const [advanced, setAdvanced] = useState(false);
  const [more, setMore] = useState(false); // SESS-038: Create more
  const [linked, setLinked] = useState<Linked | null>(null); // SESS-036: the GitHub item the workspace is named from
  const [found, setFound] = useState<Linked[]>([]); // SESS-036: issues and pull requests matching the name
  const [findNote, setFindNote] = useState("");
  const [setupSkip, setSetupSkip] = useState(false); // PROJ-033: the setup policy; the project's script runs unless skipped
  const [setupWhere, setSetupWhere] = useState<SetupWhere>("tab");
  const [setupWait, setSetupWait] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirm, setConfirm] = useState<{ projectId: string; path: string; branch: string; check: RemoveCheck; force: boolean; refusal?: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [startGit, setStartGit] = useState<{ folder: string; files: FirstFile[] } | null>(null);
  const [importing, setImporting] = useState<{ project: string; path: string; list: SetupImport[] } | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);
  const [gitVersion, setGitVersion] = useState("");
  const indexed = useRef(""); // the last project list and owner map handed to the window
  const [filterOpen, setFilterOpen] = useState(false);
  const [folded, setFolded] = useState<Set<string>>(new Set()); // group titles folded away
  const seen = useRef<Record<string, AgentState>>({});
  const groupBy = groupFromSetting(settings[GROUP_SETTING]);
  const sortBy = sortFromSetting(settings[SORT_SETTING]);
  // PROJ-050: an old "Recent" choice is moved to Smart once and saved that way.
  useEffect(() => {
    if (settings[SORT_SETTING] === "recent") onSetting(SORT_SETTING, "smart");
  }, [settings, onSetting]);
  // PROJ-063: a state change in a workspace that is not in front marks its row unread.
  useEffect(() => {
    const was = seen.current;
    const now: Record<string, AgentState> = {};
    const fresh: string[] = [];
    for (const [dir, i] of Object.entries(states)) {
      now[dir] = i.state;
      if (dir in was && was[dir] !== i.state && !(activeDir !== null && same(dir, activeDir))) fresh.push(dir);
    }
    seen.current = now;
    for (const dir of fresh) onUnread(dir, true);
  }, [states, activeDir, onUnread]);

  const say = (kind: "ok" | "warn" | "error", text: string) => setMessage({ kind, text });
  const fail = (err: unknown) => say("error", String(err));

  const scanned = useRef<Record<string, Worktree[]>>({}); // ACCT-056: the last list each scan gave
  const refreshWorktrees = useCallback(async (list: Project[]) => {
    const next: Record<string, Worktree[]> = {};
    const unseen: Record<string, Worktree[]> = {};
    for (const p of list) {
      try {
        next[p.id] = await invoke<Worktree[]>("workspace_list", { projectId: p.id });
        unseen[p.id] = await invoke<Worktree[]>("workspace_unseen", { projectId: p.id });
      } catch (err) {
        // ACCT-056: a failed scan removes nothing; the worktrees already known stay listed.
        next[p.id] = afterScan(scanned.current[p.id], null);
        say("warn", `Could not list the workspaces of ${p.name}, so the last known list stays: ${String(err)}`);
      }
    }
    scanned.current = next;
    setWorktrees(Object.fromEntries(Object.entries(next).map(([id, ws]) => [id, ws.filter((w) => !w.hidden)])));
    setHiddenWts(Object.fromEntries(Object.entries(next).map(([id, ws]) => [id, ws.filter((w) => w.hidden)])));
    setFresh(unseen);
    // GIT-065: the same poll keeps each row's unpushed badge current; a failed read keeps the last.
    const shown = Object.values(next).flat().filter((w) => !w.hidden).map((w) => w.path);
    invoke<Pushed[]>("scm_pushed", { worktrees: shown })
      .then((list) => setPushedBy(Object.fromEntries(list.map((p) => [p.path, p]))))
      .catch(() => {});
    const owner: Record<string, string> = {};
    const names: Record<string, string> = {};
    for (const p of list)
      for (const w of next[p.id] ?? []) {
        owner[w.path] = p.id;
        if (w.name) names[w.path] = w.name;
      }
    const key = JSON.stringify([list, owner, names]);
    if (key !== indexed.current) index.current(list, owner, names);
    indexed.current = key;
  }, []);
  // PROJ-063: a branch switched inside a workspace folder shows on its row within a few seconds.
  // PROJ-041: the same poll notices worktrees made outside Kolux, in both layouts (DT-O2).
  useEffect(() => {
    const t = window.setInterval(() => document.visibilityState === "visible" && refreshWorktrees(projects).catch(fail), 5000);
    return () => window.clearInterval(t);
  }, [projects, refreshWorktrees]);

  const reload = useCallback(async () => {
    const list = await invoke<Project[]>("project_list");
    setProjects(list);
    await refreshWorktrees(list);
  }, [refreshWorktrees]);

  const loadPlace = useCallback(async () => {
    const p = await invoke<PlaceInfo>("workspaces_place_get");
    setPlace(p);
    setRootDraft(p.dir);
    setFlatDraft(p.flat);
  }, []);
  useEffect(() => {
    invoke<string>("git_version").then(setGitVersion).catch(fail);
    loadPlace().catch(fail);
  }, [loadPlace]);
  useEffect(() => {
    reload().catch(fail);
  }, [reload, refresh]);

  useEffect(() => {
    if (name.trim() === "") {
      setPreview(null);
      return;
    }
    let live = true;
    invoke<Preview | null>("workspace_preview", { name, projectId: creating || null, branch: existing ? null : branchDraft.trim() || null }).then((s) => live && setPreview(s)).catch(fail);
    return () => {
      live = false;
    };
  }, [name, creating, branchDraft, existing]);
  useEffect(() => {
    setPrList(null); // PROJ-030: another project's pull requests are not this one's
    setPrDraft(null);
    setLinked((l) => (creating === null ? null : keepOnSwitch(l))); // SESS-038
  }, [creating]);
  useEffect(() => {
    // SESS-036: the chosen project's own issues and pull requests matching the name, and a pasted
    // link resolved to its item (its title seeds the name). Lookups that fail for want of gh stay quiet.
    setFound([]);
    setFindNote("");
    const item = workItem(name);
    const q = name.trim();
    if (!creating || linked || existing || prList !== null || (!item && q.length < 2)) return;
    let live = true;
    const t = setTimeout(() => {
      const ask = item
        ? invoke<Linked>("workspace_item", { projectId: creating, item }).then((l) => live && (setLinked(bound(l)), setName(l.title)))
        : invoke<Linked[]>("workspace_items", { projectId: creating, query: q }).then((l) => live && setFound(l.map(bound)));
      ask.catch((err) => live && (item || String(err).startsWith("That lookup")) && setFindNote(String(err)));
    }, item ? 0 : 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [name, creating, linked, existing, prList]);

  useEffect(() => {
    // SESS-036: the name field suggests the project's branches too.
    if (!creating) return;
    let live = true;
    invoke<string[]>("workspace_branches", { projectId: creating }).then((b) => live && setBranchList(b)).catch(fail);
    return () => {
      live = false;
    };
  }, [creating]);

  // PROJ-007: the new project's main checkout becomes the workspace in front, its worktrees listed.
  // PROJ-003: a project just cloned goes straight to its checkout, with no setup question first.
  const added = async (p: Project, offerSetup = true) => {
    say("ok", `${p.name} is a project (${p.path})`);
    setPathDraft("");
    setShowAdd(false);
    await reload();
    const open = openedWorktree(await invoke<Worktree[]>("workspace_list", { projectId: p.id }), p.path);
    if (open) onSelect(open.path, open.branch);
    if (!offerSetup) return;
    // VIEW-112: another tool's setup file in the new project is offered for import.
    const list = await invoke<SetupImport[]>("setup_imports_list", { path: p.path }).catch(() => [] as SetupImport[]);
    if (list.some((i) => !i.refused)) setImporting({ project: p.name, path: p.path, list });
    else if (refusedLine(list)) say("warn", `No setup commands imported. ${refusedLine(list)}`);
  };
  const importSetup = async (file: string) => {
    if (!importing) return;
    setBusy("importing");
    try {
      await invoke("setup_import", { path: importing.path, file });
      say("ok", `The setup commands from ${file} are in kolux.yaml; commit it so new workspaces run them.`);
      setImporting(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy("");
    }
  };
  const addPath = async (path: string) => {
    if (!path.trim()) return;
    setBusy("adding");
    try {
      await added(await invoke<Project>("project_add", { path }));
    } catch (err) {
      // GIT-061: a plain folder is offered Git and a first commit; a relative or missing path is refused.
      if (!String(err).includes("not inside a Git repository")) fail(err);
      else
        await invoke<FirstFile[]>("git_first_commit_preview", { path })
          .then((files) => setStartGit({ folder: path.trim(), files }))
          .catch(fail);
    } finally {
      setBusy("");
    }
  };
  const startGitAndAdd = async (files: string[]) => {
    if (!startGit) return;
    setBusy("adding");
    try {
      await added(await invoke<Project>("git_start", { path: startGit.folder, files }));
      setStartGit(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy("");
    }
  };

  const browse = async () => {
    try {
      const picked = await open({ directory: true, multiple: true, title: "Choose project folders" });
      const list = Array.isArray(picked) ? picked : picked ? [picked] : [];
      for (const dir of list) await addPath(dir);
    } catch (err) {
      fail(err);
    }
  };

  // SET-032: a failed save leaves the draft as typed, so Enter or leaving the field sends it again.
  const saveRoot = async (dir = rootDraft) => {
    try {
      const p = await invoke<PlaceInfo>("workspaces_place_set", { dir, flat: flatDraft });
      setPlace(p);
      setRootDraft(p.dir);
      say("ok", `workspaces go under ${p.dir}, ${p.flat ? "side by side" : "a folder per project"}`);
    } catch (err) {
      fail(err);
    }
  };

  const browseRoot = async () => {
    try {
      const picked = await open({ directory: true, title: "Choose the workspaces folder" });
      if (typeof picked === "string") {
        setRootDraft(picked);
        await saveRoot(picked);
      }
    } catch (err) {
      fail(err);
    }
  };

  const rootKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const action = placeFieldAction(e.key, e.nativeEvent.isComposing);
    if (action === "save") saveRoot();
    else if (action === "revert") setRootDraft(place.dir);
  };

  // PROJ-025 / PROJ-028: a project's own workspaces folder (empty: the global one) and base ref
  // (empty: the default branch Git reports).
  const openSettings = (p: Project) => {
    setSettingsFor(p.id);
    loadVis(p.id);
    setDirDraft(p.workspacesDir ?? "");
    setProjectBaseDraft(p.base ?? "");
  };
  const saveProject = async (p: Project) => {
    try {
      const u = await invoke<Project>("project_set", { projectId: p.id, workspacesDir: dirDraft, base: projectBaseDraft });
      say("ok", `${u.name}: workspaces ${u.workspacesDir ? `under ${u.workspacesDir}` : "in the global folder"}, starting from ${u.base ?? "the default branch"}`);
      setSettingsFor(null);
      await reload();
      await loadPlace();
    } catch (err) {
      fail(err);
    }
  };

  // PROJ-020: a stand-in row at once, then the workspace opens with a shell of its own; if the
  // user moved to another workspace meanwhile the create finishes without pulling focus back.
  // A newer create overtakes a running one (unless that one was made with Create more): Kolux
  // cancels it, and Git's half-made checkout is removed; one that finished first stays, in the
  // background. Each running create shows a stand-in row here and a stand-in tab by the panes.
  // PROJ-038: with a prompt and no agent picked, the default agent runs it, else the first installed.
  const installed = agents.filter((a) => a.installed);
  const fallbackAgent = installed.find((a) => a.id === defaultId) ?? installed[0] ?? null;
  const create = async (project: Project) => {
    const base = baseDraft.trim();
    const branch = branchDraft.trim();
    // SESS-036: a name that is an existing branch opens that branch rather than making a new one.
    const reuse = existing ? branch : !linked && branchList.includes(name.trim()) ? name.trim() : "";
    // PROJ-030: open a pull request's branch; SESS-036: a linked pull request opens the same way
    const pr = prList !== null ? prDraft : linked?.kind === "pull" ? { number: linked.number } : null;
    const issue = linked?.kind === "issue" ? linked : null;
    if (prList !== null ? !pr : existing ? !reuse : !name.trim() || preview === null) return;
    const keepOpen = more; // SESS-038: Create more keeps the composer open for the next one
    const typed = name.trim();
    const parent = parentDraft;
    const from = shown.current;
    const prompt = promptDraft.trim();
    const agent = agentDraft ? (installed.find((a) => a.id === agentDraft) ?? null) : prompt ? fallbackAgent : null;
    const mine: PendingCreate = { ticket: ++tickets.current, projectId: project.id, name: typed || (pr ? `#${pr.number}` : reuse), more: keepOpen };
    for (const t of overtakenBy(pendingNow.current, mine)) {
      overtaken.current.add(t);
      invoke("workspace_create_cancel", { ticket: t }).catch(() => {});
    }
    setPending([...pendingNow.current.filter((p) => !overtaken.current.has(p.ticket)), mine]);
    setName("");
    setBranchDraft("");
    setPromptDraft("");
    setPrDraft(null);
    setLinked(null); // SESS-038: Create more drops the linked item, ready for the next one
    if (!keepOpen) {
      setCreating(null);
      setBaseDraft("");
      setParentDraft(null);
    }
    try {
      const wt = pr
        ? await invoke<Created>("workspace_open_pr", { projectId: project.id, number: pr.number, folder: typed || null, name: typed || null, parent, ticket: mine.ticket })
        : reuse
        ? await invoke<Created>("workspace_open_branch", { projectId: project.id, branch: reuse, folder: existing ? typed || null : null, parent, ticket: mine.ticket })
        : await invoke<Created>("workspace_create", { projectId: project.id, name: typed, base: base || null, branch: branch || null, parent, ticket: mine.ticket, issue });
      const lost = overtaken.current.has(mine.ticket);
      noteRecent(project.id);
      if (stopped.current.has(mine.ticket)) {
        const n = stoppedNote(worktreeLabel(wt), null);
        say(n.kind, n.text);
        return void (await reload());
      }
      const extra = [wt.note, ...wt.warnings].filter(Boolean).join(" · ");
      say(extra ? "warn" : "ok", `created ${worktreeLabel(wt)} in ${wt.path} from ${wt.base}${extra ? ` · ${extra}` : ""}`);
      await reload();
      // The agent's tab is the workspace's first; a shell is only opened when no agent runs. With
      // Create more the new workspace does not take the front, so the next name can be typed.
      // A create overtaken after Git had already finished it stays, but never takes the front.
      const front = !keepOpen && !lost && shown.current === from;
      // PROJ-033: the project's setup script runs in a Setup terminal; a script that cannot run says why.
      const setup = setupSkip || !onSetup ? null : await invoke<SetupLine | null>("workspace_setup", { path: wt.path }).catch((err) => (say("warn", String(err)), null));
      if (agent && setup && onSetup && waitsForSetup(setupWhere, setupWait, true, true)) {
        onSetup(wt.path, wt.branch, setup, setupWhere, front, () => onStartIn(agent, wt.path, wt.branch, prompt, front));
      } else {
        if (agent) onStartIn(agent, wt.path, wt.branch, prompt, front);
        else if (front) onSelect(wt.path, wt.branch, true);
        if (setup && onSetup) onSetup(wt.path, wt.branch, setup, setupWhere, false);
      }
    } catch (err) {
      if (stopped.current.has(mine.ticket)) {
        const n = stoppedNote(mine.name, String(err));
        say(n.kind, n.text);
      } else if (overtaken.current.has(mine.ticket)) say("warn", `${mine.name}: ${String(err)}`);
      else fail(err);
    } finally {
      overtaken.current.delete(mine.ticket);
      stopped.current.delete(mine.ticket);
      setStopping((s) => s.filter((t) => t !== mine.ticket));
      setPending(pendingNow.current.filter((p) => p.ticket !== mine.ticket));
      if (keepOpen) nameRef.current?.focus();
    }
  };

  // The project in front: the one whose workspace is shown, else the first; "" with none yet.
  const projectInFront = () => projects.find((p) => (worktrees[p.id] ?? []).some((w) => activeDir !== null && same(activeDir, w.path)))?.id ?? projects[0]?.id ?? "";
  const openCreate = () => {
    const id = projectInFront();
    if (createOpens(id) === "add") setShowAdd(true);
    else setCreating(id);
  };
  useEffect(() => {
    if (createRequest === 0) return;
    openCreate();
    if (createName) setName(createName);
  }, [createRequest]);
  useEffect(() => {
    // VIEW-048: the row under the pointer, read at key time so a row that just went away never counts
    const hovered = [...document.querySelectorAll<HTMLElement>("[data-path]:hover")].pop()?.dataset.path ?? null;
    const target = deleteTarget(hovered, activeDir);
    if (deleteRequest === 0 || target === null) return;
    for (const p of projects) {
      const w = (worktrees[p.id] ?? []).find((x) => !x.isMain && same(target, x.path));
      if (w) return void ask(p.id, w.path, worktreeLabel(w));
    }
    say("warn", `The workspace ${hovered === null ? "shown" : "under the pointer"} is not one Kolux can delete (a project's main folder, or no workspace).`);
  }, [deleteRequest]);
  // SESS-035: Recent (projects the composer made workspaces in), then the rest by match, then Add project.
  const projectItems = (q: string): PickItem[] => {
    const hints = pathHints(projects);
    const r = rankProjects(projects, q, readRecent());
    const item = (group: string) => (m: ProjectMatch<Project>): PickItem => ({ key: m.p.id, label: m.p.name, hits: m.hits, group, title: m.p.path, hint: hints[m.p.id] && middle(hints[m.p.id], 28) });
    return [...r.recent.map(item("Recent")), ...r.rest.map(item("Projects")), { key: ADD_ITEM, label: "Add project…" }];
  };
  const pickProject = (id: string) => {
    if (id === ADD_ITEM) {
      setCreating(null);
      setAdding(true);
    } else if (id !== creating) {
      setCreating(id);
      setParentDraft(null); // the parent belongs to the old project
    }
  };
  // SESS-037: any workspace of the project but its main checkout can be the parent.
  const parentItems = (p: Project) => (q: string): PickItem[] => [
    ...(q.trim() ? [] : [{ key: "", label: "No parent" }]),
    ...(worktrees[p.id] ?? []).flatMap((w) => {
      const hits = w.isMain ? null : q.trim() ? matchLetters(q.trim(), worktreeLabel(w)) : [];
      return hits ? [{ key: w.path, label: worktreeLabel(w), hits, title: w.path }] : [];
    }),
  ];
  const parentLabel = (p: Project) => {
    const w = parentDraft ? (worktrees[p.id] ?? []).find((x) => same(x.path, parentDraft)) : undefined;
    return w ? worktreeLabel(w) : "No parent";
  };
  // SESS-038: Enter submits from the name and branch fields only, never mid input-method composition.
  const submitKeys = (p: Project | null) => (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && p) create(p);
    else if (e.key === "Escape") setCreating(null);
  };
  const reusing = !existing && prList === null && !linked && branchList.includes(name.trim());
  const openPrs = (p: Project) => {
    setExisting(false);
    setPrList([]);
    invoke<PrHead[]>("workspace_prs", { projectId: p.id }).then(setPrList).catch((err) => {
      setPrList(null);
      fail(err);
    });
  };
  const nameField = (p: Project | null) => (
    <div className="sb-form composer" data-create={p?.id ?? ""}>
      <Picker key={`project-${p?.id ?? ""}`} name="Project" value={p?.name ?? "pick a project"} items={projectItems} onPick={pickProject} startOpen={!p} />
      <input
        ref={nameRef}
        aria-label="workspace name"
        className="field"
        list="branch-list"
        placeholder={existing ? "folder name (optional: the branch name)" : "name, or an existing branch"}
        value={name}
        autoFocus={!!p}
        onChange={(e) => setName(shortcodes(e.target.value))}
        onKeyDown={submitKeys(p)}
      />
      <div className="preview">
        {linked ? `linked to ${itemLabel(linked)}${linked.kind === "pull" ? ", its branch checked out" : ", on a new branch"}` : prList !== null ? (prDraft ? `checks out pull request #${prDraft.number} (${prDraft.headRefName}) at its latest commit, linked to it` : prList.length ? "Pick the pull request under Advanced." : "No open pull requests.") : existing ? (branchDraft.trim() ? `checks out ${branchDraft.trim()} as it is, its commits kept` : "Pick the branch to open under Advanced.") : reusing ? `uses the existing branch ${name.trim()} as it is, its commits kept` : previewSentence(name, preview, p)}
      </div>
      {linked && (
        <div className="btn-row">
          <button className="link" onClick={() => setLinked(null)}>
            Unlink {linked.kind === "pull" ? "the pull request" : "the issue"}
          </button>
        </div>
      )}
      {findNote && <div className="preview warn">{findNote}</div>}
      {found.length > 0 && (
        <div className="pick-list" aria-label="issues and pull requests">
          {found.map((f) => (
            <button key={f.url} type="button" className="pick-item" title={f.url} onClick={() => (setLinked(f), setName(f.title), nameRef.current?.focus())}>
              <span className="name">#{f.number} {f.title}</span>
              <span className="hint">{f.kind === "pull" ? "pull request" : "issue"}</span>
            </button>
          ))}
        </div>
      )}
      {p && <Picker key={`parent-${p.id}`} name="Parent" value={parentLabel(p)} items={parentItems(p)} onPick={(k) => setParentDraft(k || null)} onEmptyEnter={() => setParentDraft(null)} />}
      <select aria-label="agent" className="field" value={agentDraft} onChange={(e) => setAgentDraft(e.target.value)}>
        <option value="">{promptDraft.trim() && fallbackAgent ? `${fallbackAgent.name} (default)` : "No agent: a terminal"}</option>
        {installed.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <textarea aria-label="note" className="field multi grow" placeholder="note: the first prompt for the agent (optional)" value={promptDraft} onChange={(e) => setPromptDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setCreating(null)} />
      <button className="link" aria-expanded={advanced || existing || prList !== null} onClick={() => setAdvanced(!(advanced || existing || prList !== null))}>
        {advanced || existing || prList !== null ? "Hide advanced" : "Advanced…"}
      </button>
      {(advanced || existing || prList !== null) && (
        <div className="composer-advanced" data-advanced>
          <label>Branch name</label>
          <input
            aria-label="branch name"
            className="field"
            list={existing ? "branch-list" : undefined}
            placeholder={existing ? "existing branch, e.g. feat/x" : `from the name${preview && name.trim() ? `: ${preview.branch}` : ""}`}
            value={branchDraft}
            onChange={(e) => setBranchDraft(e.target.value)}
            onKeyDown={submitKeys(p)}
          />
          <label className="check">
            <input type="checkbox" aria-label="reuse an existing branch" checked={existing} onChange={(e) => (setExisting(e.target.checked), setPrList(null), setPrDraft(null))} />
            Reuse an existing branch (check it out, make none)
          </label>
          <label className="check">
            <input type="checkbox" aria-label="open a pull request" checked={prList !== null} onChange={(e) => (e.target.checked && p ? openPrs(p) : (setPrList(null), setPrDraft(null)))} />
            Open a pull request (its branch, linked to it)
          </label>
          {prList !== null && (
            <Picker key={`pr-${p?.id ?? ""}`} name="Pull request" value={prDraft ? `#${prDraft.number} ${prDraft.title}` : "pick a pull request"} items={(q) => prItems(prList, q)} onPick={(k) => setPrDraft(prList.find((x) => String(x.number) === k) ?? null)} startOpen={!prDraft} />
          )}
          <label>Setup</label>
          <select aria-label="setup policy" className="field" value={setupSkip ? "skip" : "run"} onChange={(e) => setSetupSkip(e.target.value === "skip")}>
            <option value="run">Run the project's setup script (kolux.yaml)</option>
            <option value="skip">Skip setup</option>
          </select>
          {!setupSkip && (
            <select aria-label="setup opens in" className="field" value={setupWhere} onChange={(e) => setSetupWhere(e.target.value as SetupWhere)}>
              <option value="tab">Setup in a new tab</option>
              <option value="right">Setup in a split to the right</option>
              <option value="down">Setup in a split below</option>
            </select>
          )}
          {!setupSkip && setupWhere === "tab" && (
            <label className="check">
              <input type="checkbox" aria-label="wait for setup" checked={setupWait} onChange={(e) => setSetupWait(e.target.checked)} />
              Wait for setup to finish before the agent starts
            </label>
          )}
          {!existing && prList === null && (
            <input aria-label="start from" className="field" placeholder={p?.base ? `start from: ${p.base} (saved)` : "start from: the default branch"} value={baseDraft} onChange={(e) => setBaseDraft(e.target.value)} onKeyDown={submitKeys(p)} />
          )}
        </div>
      )}
      <datalist id="branch-list">
        {branchList.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <div className="btn-row">
        <button className="btn" onClick={() => p && create(p)} disabled={busy !== "" || !p || (prList !== null ? !prDraft : existing ? !branchDraft.trim() : !name.trim() || preview === null)}>
          Create workspace
        </button>
        <button className="btn" onClick={() => setCreating(null)}>
          Cancel
        </button>
        <label className="check">
          <input type="checkbox" aria-label="create more" checked={more} onChange={(e) => setMore(e.target.checked)} />
          Create more
        </label>
      </div>
    </div>
  );

  // PROJ-070: look at the workspace first; the question shows what would be lost, and a clean
  // one with the question switched off goes straight to deleting.
  const ask = async (projectId: string, path: string, branch: string) => {
    setBusy("checking");
    let asked = null;
    try {
      const check = await invoke<RemoveCheck>("workspace_remove_check", { projectId, path });
      const settings = await invoke<Record<string, unknown>>("get_settings");
      asked = { projectId, path, branch, check, force: false };
      if (!skipsQuestion(check, settings)) {
        setConfirm(asked);
        asked = null;
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy("");
    }
    if (asked) await remove(asked);
  };
  const remove = async (c = confirm) => {
    if (!c) return;
    setBusy("removing");
    try {
      await invoke("workspace_remove", { projectId: c.projectId, path: c.path, force: c.force, stamp: c.check.stamp });
      onRemoved(c.path);
      say("ok", `removed ${c.branch} and its folder`);
      setConfirm(null);
      await reload();
    } catch (err) {
      // refused: say why in the question, showing the workspace as it is now with the force box cleared
      const check = await invoke<RemoveCheck>("workspace_remove_check", { projectId: c.projectId, path: c.path }).catch(() => null);
      if (check) setConfirm({ ...c, check, force: false, refusal: String(err) });
      else fail(err);
    } finally {
      setBusy("");
    }
  };

  // PROJ-042: hide or show one worktree; the poll shows the change, this just does not wait for it.
  // PROJ-048: the parents a workspace can move under, and the move itself. The picker closes
  // first, so a refusal shows once it is gone.
  const moveItems = (p: Project, w: Worktree) => (q: string): PickItem[] => {
    const all = worktrees[p.id] ?? [];
    const top = w.parent && all.some((x) => !x.isMain && same(x.path, w.parent as string)) && !q.trim() ? [{ key: "", label: "No parent", hint: "top level" }] : [];
    return [
      ...top,
      ...parentChoices(all, w).flatMap((x) => {
        const hits = q.trim() ? matchLetters(q.trim(), worktreeLabel(x)) : [];
        return hits ? [{ key: x.path, label: worktreeLabel(x), hits, title: x.path }] : [];
      }),
    ];
  };
  const move = async (p: Project, w: Worktree, parent: string) => {
    setMoving(null);
    try {
      await invoke("workspace_set_parent", { projectId: p.id, path: w.path, parent: parent || null });
      await refreshWorktrees(projects);
    } catch (err) {
      say("warn", `${worktreeLabel(w)} was not moved: ${String(err)}`);
    }
  };
  const hide = async (w: Worktree, hidden: boolean) => {
    try {
      await invoke("workspace_hide", { path: w.path, hidden });
      await refreshWorktrees(projects);
    } catch (err) {
      fail(err);
    }
  };
  const doneReview = async (p: Project) => {
    try {
      await invoke("workspace_seen", { projectId: p.id });
      setReview(null);
      await refreshWorktrees(projects);
    } catch (err) {
      fail(err);
    }
  };
  // SET-032 / PROJ-042: which worktrees made outside Kolux show, per source, globally and per project.
  const loadVis = async (projectId: string | null) => {
    try {
      const list = await invoke<VisSource[]>("visibility_get", { projectId });
      if (projectId) setVisOwn(list);
      else setVisGlobal(list);
    } catch (err) {
      fail(err);
    }
  };
  const setVis = async (projectId: string | null, source: string, show: boolean | null) => {
    try {
      await invoke("visibility_set", { projectId, source, show });
      await loadVis(projectId);
      await refreshWorktrees(projects);
    } catch (err) {
      fail(err);
    }
  };
  const addRoot = async () => {
    try {
      await invoke("visibility_root_add", { path: rootPath });
      setRootPath("");
      setRootError("");
      await loadVis(null);
      await refreshWorktrees(projects);
    } catch (err) {
      setRootError(String(err));
    }
  };
  const removeRoot = async (path: string) => {
    try {
      await invoke("visibility_root_remove", { path });
      await loadVis(null);
      await refreshWorktrees(projects);
    } catch (err) {
      fail(err);
    }
  };
  const showWord = (b: boolean) => (b ? "Shown" : "Hidden");
  const globalVis = () => (
    <div data-visibility-defaults>
      <label title={GLOSSARY.worktree.hover}>Workspaces Kolux did not make, by default</label>
      {visGlobal.map((s) => (
        <div key={s.key}>
          <div className="preview" title={s.root ?? s.label}>
            {s.label}
          </div>
          <div className="vis-row">
          <select aria-label={`default for ${s.label}`} className="field" value={s.global ? "show" : "hide"} onChange={(e) => setVis(null, s.key, e.target.value === "show")}>
            <option value="hide">Hidden</option>
            <option value="show">Shown</option>
          </select>
          {s.root && (
            <button className="ib" title={`Stop treating ${s.root} as its own source`} onClick={() => removeRoot(s.root!)}>
              <Close size={11} />
            </button>
          )}
          </div>
        </div>
      ))}
      <input
        aria-label="extra root folder"
        className="field"
        placeholder="another folder that holds workspaces (starts hidden)"
        value={rootPath}
        onChange={(e) => {
          setRootPath(e.target.value);
          setRootError("");
        }}
        onKeyDown={(e) => e.key === "Enter" && addRoot()}
      />
      {rootError && <div className="preview warn">{rootError}</div>}
      <div className="btn-row">
        <button className="btn" onClick={addRoot} disabled={!rootPath.trim()}>
          Add folder
        </button>
      </div>
    </div>
  );
  const ownVis = (p: Project) => (
    <>
      <label title={GLOSSARY.worktree.hover}>Workspaces Kolux did not make, in {p.name}</label>
      {visOwn.map((s) => (
        <div key={s.key}>
          <div className="preview" title={s.root ?? s.label}>
            {s.label}
          </div>
          <div className="vis-row">
          <select aria-label={`${p.name}: ${s.label}`} className="field" value={s.own === null ? "global" : s.own ? "show" : "hide"} onChange={(e) => setVis(p.id, s.key, e.target.value === "global" ? null : e.target.value === "show")}>
            <option value="global">As global: {showWord(s.global)}</option>
            <option value="hide">Hidden</option>
            <option value="show">Shown</option>
          </select>
          {s.own !== null && (
            <button className="btn" title={`Back to the global choice (${showWord(s.global)})`} onClick={() => setVis(p.id, s.key, null)}>
              Reset
            </button>
          )}
          </div>
        </div>
      ))}
      <button
        className="link"
        onClick={() => {
          setSettingsFor(null);
          loadVis(null);
          setShowAdd(true);
        }}
      >
        Global defaults…
      </button>
    </>
  );
  const PAGE = 10;
  const hiddenList = (p: Project) => {
    const all = hiddenWts[p.id] ?? [];
    const pages = Math.max(1, Math.ceil(all.length / PAGE));
    const at = Math.min(hiddenPage, pages - 1);
    return (
      <>
        <label title={GLOSSARY.worktree.hover}>Hidden workspaces ({all.length})</label>
        {all.length === 0 && <div className="preview">None hidden.</div>}
        {all.slice(at * PAGE, at * PAGE + PAGE).map((w) => (
          <div className="vis-row" key={w.path}>
            <span className="path" title={w.path}>{relPath(p.path, w.path)}</span>
            <button className="btn" onClick={() => hide(w, false)}>
              Show
            </button>
          </div>
        ))}
        {pages > 1 && (
          <div className="btn-row">
            <button className="btn" disabled={at === 0} onClick={() => setHiddenPage(at - 1)}>
              Previous
            </button>
            <span className="preview">
              page {at + 1} of {pages}
            </span>
            <button className="btn" disabled={at >= pages - 1} onClick={() => setHiddenPage(at + 1)}>
              Next
            </button>
          </div>
        )}
      </>
    );
  };

  const same = (a: string, b: string) => a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();
  const openCount = (w: Worktree) => openDirs.filter((d) => same(d, w.path)).length;
  const isActive = (w: Worktree) => openCount(w) > 0;
  const isSelected = (w: Worktree) => activeDir !== null && same(activeDir, w.path);
  const infoOf = (w: Worktree): RowInfo => Object.entries(states).find(([d]) => same(d, w.path))?.[1] ?? { state: "idle", changed: 0, pr: null };
  const isUnread = (w: Worktree) => [...unread].some((d) => same(d, w.path));
  const setRead = (w: Worktree, read: boolean) => onUnread(w.path, !read);
  const show = (w: Worktree) => {
    setRead(w, true);
    onSelect(w.path, w.branch);
  };
  type Entry = { p: Project; w: Worktree };
  const order = (xs: Entry[]) => (sortBy === "smart" ? smartOrder(xs, (x) => infoOf(x.w)) : orderWorktrees(xs.map((x) => x.w)).map((w) => xs.find((x) => x.w === w) as Entry));
  const toggleFold = (title: string) => setFolded((f) => new Set(f.has(title) ? [...f].filter((t) => t !== title) : [...f, title]));

  // One workspace row: its state dot, name, unread mark, and the Remove and Mark unread buttons;
  // under a project, a child sits `depth` steps in and a parent with `kids` folds them (PROJ-047).
  const row = ({ p, w }: Entry, depth = 0, kids = false) => {
    const asking = confirm?.path === w.path;
    const info = infoOf(w);
    const un = isUnread(w);
    const shut = shutKids.has(w.path);
    const up = w.parent ? (worktrees[p.id] ?? []).find((x) => !x.isMain && same(x.path, w.parent as string)) : undefined;
    return (
      <div key={w.path} data-worktree={worktreeLabel(w)} data-depth={depth} data-path={w.path}>
        <div className={`sess${isSelected(w) ? " sel" : ""}${un ? " unread" : ""}`} role="button" tabIndex={0} onClick={() => show(w)} onKeyDown={(e) => e.key === "Enter" && show(w)} title={`Show ${w.path}`} data-state={info.state} style={depth || kids ? { paddingLeft: 26 + depth * 14 - (kids ? 24 : 0) } : undefined}>
          {kids && (
            <button
              className={`fold${shut ? " shut" : ""}`}
              aria-expanded={!shut}
              title={shut ? "Show the workspaces made from this one" : "Fold away the workspaces made from this one"}
              onClick={(e) => {
                e.stopPropagation();
                setShutKids((f) => new Set(shut ? [...f].filter((x) => x !== w.path) : [...f, w.path]));
              }}
            >
              <ChevronDown size={12} />
            </button>
          )}
          <span className={`dot ${info.state}${isActive(w) ? " live" : ""}`} role="img" aria-label={isActive(w) || info.state !== "idle" ? info.state : "idle"} data-tip={VOCAB[info.state].explain} />
          <span className="name">{worktreeLabel(w)}</span>
          {w.kind === "external" && (
            <span className="hint" title="Made outside Kolux (plain Git or another tool); Kolux has no record of making it">
              external
            </span>
          )}
          {pushTag(w)}
          {groupBy !== "project" && <span className="hint">{p.name}</span>}
          {!asking && (
            <button
              className="ib"
              title={un ? "Mark read" : "Mark unread"}
              onClick={(e) => {
                e.stopPropagation();
                setRead(w, un);
              }}
            >
              <Bell size={11} />
            </button>
          )}
          {!asking && !w.isMain && (
            <button
              className="ib"
              title="Change parent: move this workspace under another one, or back to the top level"
              aria-expanded={moving === w.path}
              onClick={(e) => {
                e.stopPropagation();
                setMoving(moving === w.path ? null : w.path);
              }}
            >
              <ArrowRight size={11} />
            </button>
          )}
          {!asking && !w.isMain && (
            <button
              className="ib"
              title="Hide this worktree from the sidebar (project settings list it to show again)"
              onClick={(e) => {
                e.stopPropagation();
                hide(w, true);
              }}
            >
              <EyeOff size={11} />
            </button>
          )}
          {!asking && !w.isMain && (
            <button
              className="ib"
              title="Remove this workspace: deletes its folder, and its branch unless it was opened on an existing one"
              disabled={busy !== ""}
              onClick={(e) => {
                e.stopPropagation();
                void ask(p.id, w.path, worktreeLabel(w));
              }}
            >
              <Close size={11} />
            </button>
          )}
        </div>
        {moving === w.path && !asking && (
          <div className="sb-form" data-moving={worktreeLabel(w)}>
            <Picker key={`move-${w.path}`} name="Move under" value={up ? worktreeLabel(up) : "No parent"} startOpen items={moveItems(p, w)} onPick={(k) => void move(p, w, k)} />
            <div className="btn-row">
              <button className="btn" onClick={() => setMoving(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {asking && (
          <div className="sb-form warn">
            <span>
              Remove <b>{confirm.branch}</b> and its folder? Its branch is deleted too, unless the workspace was opened on a branch that already existed.{" "}
              {blocker(confirm.check) ?? (confirm.check.changes.length > 0 ? `${confirm.check.changes.length} uncommitted or untracked change${confirm.check.changes.length === 1 ? "" : "s"} would be lost:` : "Nothing uncommitted is there.")}
            </span>
            {confirm.check.changes.length > 0 && (
              <ul className="del-changes" aria-label="changes that would be lost">
                {shownChanges(confirm.check).lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
                {shownChanges(confirm.check).more > 0 && <li>and {shownChanges(confirm.check).more} more</li>}
              </ul>
            )}
            {confirm.refusal && (
              <span className="note error" role="alert">
                {confirm.refusal}
              </span>
            )}
            {confirm.check.changes.length > 0 && !blocker(confirm.check) && (
              <label className="del-force">
                <input type="checkbox" checked={confirm.force} onChange={(e) => setConfirm({ ...confirm, force: e.target.checked })} />
                Delete my changes too
              </label>
            )}
            <div className="btn-row">
              <button className="btn danger" onClick={() => remove()} disabled={busy !== "" || blocker(confirm.check) !== null}>
                {busy === "removing" ? "Removing…" : "Remove"}
              </button>
              <button className="btn" onClick={() => setConfirm(null)}>
                Keep
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };
  const standIn = (p: Project) =>
    pending
      .filter((c) => c.projectId === p.id)
      .map((c) => (
        <div key={c.ticket} className="sess pending" data-pending={c.name} aria-busy="true">
          <span className="dot" role="img" aria-label="creating" />
          <span className="name">{c.name}</span>
          <span className="hint">{stopping.includes(c.ticket) ? "stopping…" : "creating…"}</span>
          {!stopping.includes(c.ticket) && (
            <button className="ib" title={`Cancel creating ${c.name}; what Git made so far is removed`} aria-label={`cancel creating ${c.name}`} onClick={() => stopCreate(c.ticket)}>
              ×
            </button>
          )}
        </div>
      ));

  return (
    <div className="sidebar-wrap">
      <aside className="sidebar" aria-label="Sidebar">
        <nav className="sb-nav">
          {chromeShown(settings, "tasksButton") && (
            <button className="row" title="Tasks (not built yet)">
              <span className="ic">
                <List />
              </span>
              Tasks
            </button>
          )}
          <button className={`row${artifactsOn ? " on" : ""}`} aria-current={artifactsOn ? "page" : undefined} onClick={onArtifacts}>
            <span className="ic">
              <FileCode />
            </span>
            Artifacts
          </button>
          <button className="row" onClick={openKits}>
            <span className="ic">
              <Box />
            </span>
            Starter kits
          </button>
          {chromeShown(settings, "automationsButton") && <AutomationsRow open={page === "automations"} onOpen={() => onPage("automations")} onHide={() => onSetting("automationsButton", false)} />}
        </nav>

        <div className="sb-section">
          Projects
          <span className="icons">
            <button className="ib" title="Notifications (not built yet)">
              <Bell size={13} />
            </button>
            <button className={`ib${filterOpen ? " on" : ""}`} title="Group and sort the list" aria-pressed={filterOpen} onClick={() => setFilterOpen((o) => !o)}>
              <Sliders size={13} />
            </button>
            <button className="ib" title="Add project: clone, open a folder or start a new one" aria-pressed={adding} onClick={() => setAdding(true)} disabled={busy !== ""}>
              <FolderPlus size={13} />
            </button>
            <button className="ib" title="New workspace: a branch in its own folder" aria-pressed={creating !== null} onClick={() => (creating === null ? openCreate() : setCreating(null))}>
              <Plus size={13} />
            </button>
            <button className="ib" title="Launch (not built yet)">
              <Rocket size={13} />
            </button>
          </span>
        </div>

        <div className="sb-tabs" role="tablist">
          <button role="tab" aria-pressed="true">
            Workspaces
          </button>
          <button role="tab" aria-pressed="false" title="Status (not built yet)">
            Status
          </button>
        </div>

        <div className="sb-list">
          {showAdd && (
            <div className="sb-form">
              <label>Add project</label>
              <input aria-label="project folder" className="field" placeholder="path to a folder" value={pathDraft} onChange={(e) => setPathDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPath(pathDraft)} />
              <div className="btn-row">
                <button className="btn" onClick={() => addPath(pathDraft)} disabled={busy !== "" || !pathDraft.trim()}>
                  Add
                </button>
                <button className="btn" onClick={browse} disabled={busy !== ""}>
                  Browse…
                </button>
              </div>
              <label>Workspaces folder{place.fromEnv && rootDraft === place.dir ? " (from KOLUX_WORKSPACES_DIR)" : ""}</label>
              <input aria-label="workspaces folder" className="field" list="used-dirs" value={rootDraft} onChange={(e) => setRootDraft(e.target.value)} onKeyDown={rootKey} onBlur={() => rootDraft !== place.dir && saveRoot()} />
              <label>Layout</label>
              <select aria-label="workspaces layout" className="field" value={flatDraft ? "flat" : "nested"} onChange={(e) => setFlatDraft(e.target.value === "flat")}>
                <option value="nested">Nested: a folder per project</option>
                <option value="flat">Flat: all side by side</option>
              </select>
              <div className="btn-row">
                <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => saveRoot()} disabled={rootDraft === place.dir && flatDraft === place.flat}>
                  Save
                </button>
                <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={browseRoot}>
                  Browse…
                </button>
                <button className="btn" onClick={() => setRootDraft("")} title="Empty means the default folder">
                  Use default
                </button>
              </div>
              <button type="button" className="link" data-git-settings onClick={() => {
                setShowAdd(false);
                openSettingsPage("git");
              }}>
                Branch prefix and compare base: the Git page in Settings
              </button>
              <label className="check">
                <input type="checkbox" checked={nest} onChange={(e) => onNest(e.target.checked)} />
                Nest child workspaces under their parent
              </label>
              {globalVis()}
            </div>
          )}

          <datalist id="used-dirs">
            {place.used.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          {filterOpen && (
            <div className="sb-form" data-filter>
              <label>Group by</label>
              <select aria-label="group by" className="field" value={groupBy} onChange={(e) => onSetting(GROUP_SETTING, e.target.value)}>
                <option value="project">Project</option>
                <option value="none">None: one flat list</option>
                <option value="status">Status</option>
                <option value="pr">Pull request</option>
              </select>
              <label>Sort</label>
              <select aria-label="sort" className="field" value={sortBy} onChange={(e) => onSetting(SORT_SETTING, e.target.value)}>
                <option value="smart">Smart: what needs you first</option>
                <option value="name">Name</option>
              </select>
            </div>
          )}
          {creating === "" && nameField(null)}
          {projects.length === 0 && !showAdd && <div className="sb-hint">No projects yet. Use the folder button above to add a project folder; one without Git can start it here.</div>}

          {groupBy === "project" &&
            projects.map((p) => {
              const list = worktrees[p.id] ?? [];
              const main = list.find((w) => w.isMain);
              const others = order(list.filter((w) => !w.isMain).map((w) => ({ p, w })));
              const opening = creating === p.id;
              return (
                <div key={p.id}>
                  <div className="proj" title={p.path}>
                    <span className="name">{p.name}</span>
                    <button className={`ib${settingsFor === p.id ? " on" : ""}`} title="Project settings: its workspaces folder and base ref" aria-pressed={settingsFor === p.id} onClick={() => (settingsFor === p.id ? setSettingsFor(null) : openSettings(p))}>
                      <Gear />
                    </button>
                    <button className={`ib${opening ? " on" : ""}`} title="New workspace: a branch in its own folder" aria-pressed={opening} onClick={() => setCreating(opening ? null : p.id)}>
                      <Plus size={13} />
                    </button>
                  </div>
                  {main && (
                    <button className={`branch${isSelected(main) ? " sel" : ""}`} onClick={() => show(main)} title={`Show ${main.path}`}>
                      <span className={`dot ${infoOf(main).state}${isActive(main) ? " live" : ""}`} role="img" aria-label={infoOf(main).state} data-tip={VOCAB[infoOf(main).state].explain} />
                      <span className="name">{worktreeLabel(main)}</span>
                      {pushTag(main)}
                      {isActive(main) && <span className="count">{openCount(main)}</span>}
                      <span className="chev">
                        <ChevronDown size={12} />
                      </span>
                    </button>
                  )}
                  {settingsFor === p.id && (
                    <div className="sb-form" data-project-settings={p.id}>
                      <label>Workspaces folder for {p.name}</label>
                      <input aria-label="project workspaces folder" className="field" list="used-dirs" placeholder={`global: ${place.dir}`} value={dirDraft} onChange={(e) => setDirDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveProject(p)} />
                      {hiddenList(p)}
                      {ownVis(p)}
                      <label>Base ref</label>
                      <input aria-label="project base ref" className="field" placeholder="the default branch Git reports" value={projectBaseDraft} onChange={(e) => setProjectBaseDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveProject(p)} />
                      <div className="btn-row">
                        <button className="btn" onClick={() => saveProject(p)}>
                          Save
                        </button>
                        <button className="btn" onClick={() => setSettingsFor(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {(fresh[p.id] ?? []).length > 0 && review !== p.id && (
                    <button className="sb-notice" onClick={() => setReview(p.id)} title="Worktrees made with plain Git or another tool since you last looked">
                      {fresh[p.id].length} new workspace{fresh[p.id].length === 1 ? "" : "s"}
                    </button>
                  )}
                  {review === p.id && (
                    <div className="sb-form" data-review={p.id}>
                      <label title={GLOSSARY.worktree.hover}>New workspaces in {p.name}</label>
                      {(fresh[p.id] ?? []).map((w) => (
                        <div className="vis-row" key={w.path}>
                          <span className="path" title={w.path}>{relPath(p.path, w.path)}</span>
                          <button className="btn" onClick={() => hide(w, !w.hidden)}>
                            {w.hidden ? "Show" : "Hide"}
                          </button>
                        </div>
                      ))}
                      <div className="btn-row">
                        <button className="btn" onClick={() => doneReview(p)}>
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                  {opening && nameField(p)}
                  {standIn(p)}
                  {nestRows(others.map((x) => x.w), nest, shutKids, (ws) => ws).map((r) => row({ p, w: r.w }, r.depth, r.kids))}
                </div>
              );
            })}

          {/* PROJ-045: one list across projects, flat or under Status / Pull request headers that fold. */}
          {groupBy !== "project" && creating && nameField(projects.find((p) => p.id === creating) ?? null)}
          {groupBy !== "project" && projects.map(standIn)}
          {groupBy !== "project" &&
            groupRows(
              order(projects.flatMap((p) => (worktrees[p.id] ?? []).map((w) => ({ p, w })))),
              groupBy,
              (x) => infoOf(x.w),
              (x) => x.p.name,
            ).map((g) => (
              <div key={g.title} data-group={g.title}>
                {g.title && (
                  <button className="sb-group" aria-expanded={!folded.has(g.title)} onClick={() => toggleFold(g.title)}>
                    {g.title}
                    <span className="count">{g.rows.length}</span>
                    <span className="chev">
                      <ChevronDown size={12} />
                    </span>
                  </button>
                )}
                {!folded.has(g.title) && g.rows.map((x) => row(x))}
              </div>
            ))}

          {message && <div className={`note ${message.kind}`}>{message.text}</div>}
        </div>

        <div className="sb-divider" />
        <div className="sb-next">
          Next that needs you
          <span className="hint"><KeyText id="terminals.focusNextNeedsYou" /></span>
        </div>
        <button className="sb-new" title="New session: start an agent in a new pane inside a fresh workspace" aria-haspopup="menu" aria-expanded={plusOpen} onClick={() => setPlusOpen((o) => !o)} disabled={launching}>
          <Plus size={13} />
          {launching ? "Starting…" : "New session"}
        </button>
        {plusOpen && (
          <PlusMenu
            agents={agents}
            defaultId={defaultId}
            onSetDefault={onSetDefault}
            allOff={allOff}
            pass={pass}
            onRefresh={onRefresh}
            onChoose={() => {
              setPlusOpen(false);
              onChoose();
            }}
            busy={launching}
            style={{ left: 16, bottom: 56 }}
            onClose={() => setPlusOpen(false)}
            onTerminal={
              onTerminal &&
              (() => {
                setPlusOpen(false);
                onTerminal();
              })
            }
            onManage={() => {
              setPlusOpen(false);
              openSettingsPage("agents");
            }}
            onPick={(a) => {
              setPlusOpen(false);
              onLaunch(a, projects.length === 1 ? projects[0].id : null);
            }}
          />
        )}
        {adding && <AddProject onBrowse={browse} onClose={() => setAdding(false)} onAdded={(p) => { setAdding(false); void added(p, false); }} />}
        <div className="sb-foot">
          <button
            className="ib"
            title={`Add a project by path, or change the workspaces folder${gitVersion ? ` · ${gitVersion}` : ""}`}
            aria-pressed={showAdd}
            onClick={() => {
              if (!showAdd) loadVis(null);
              setShowAdd((s) => !s);
            }}
          >
            <Gear />
          </button>
          {/* SET-028: until Settings > Agents exists (T-036, T-054), model routing opens from here. */}
          <button className="ib" title="Model routing: the model and effort for each worker tier" aria-pressed={page === "routing"} onClick={() => onPage("routing")}>
            <Sliders size={14} />
          </button>
          <button className="ib" title="Help (not built yet)">
            <Help />
          </button>
          <button className="upd" title="Check for a newer version of Kolux RS" onClick={requestUpdateCheck}>
            <Refresh size={13} />
            Check for updates
          </button>
          <button className="ib" title="Focus (not built yet)">
            <Target />
          </button>
          <button className="ib" title="Right rail (not built yet)">
            <Rail />
          </button>
        </div>
      </aside>
      {importing && <ImportSetup {...importing} busy={busy !== ""} onImport={importSetup} onClose={() => setImporting(null)} />}
      {startGit && <StartGit {...startGit} busy={busy !== ""} onStart={startGitAndAdd} onCancel={() => setStartGit(null)} />}
    </div>
  );
}
