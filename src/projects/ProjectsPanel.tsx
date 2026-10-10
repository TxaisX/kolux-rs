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
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { GROUP_SETTING, SORT_SETTING, groupFromSetting, groupRows, smartOrder, sortFromSetting, type AgentState, type RowInfo } from "./rows";
import { nestRows, openedWorktree, orderWorktrees, relPath, placeFieldAction, previewSentence, worktreeLabel, type Created, type PlaceInfo, type Preview, type Project, type Worktree } from "./model";
import { Bell, ChevronDown, Clock, Close, EyeOff, FileCode, FolderPlus, Gear, Help, List, Plus, Rail, Refresh, Rocket, Sliders, Target } from "../chrome/icons";
import PlusMenu, { type AgentInfo } from "../launch/PlusMenu";
import { KeyText } from "../keys/KeymapContext";

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
  onSelect: (dir: string, branch: string | null) => void;
  /** After a workspace and its folder are gone, so the window drops its panes. */
  onRemoved: (path: string) => void;
  /** The plus menu behind "New session" (T-004): agents found on the PATH, and the launch. */
  agents: AgentInfo[];
  launching: boolean;
  onLaunch: (agent: AgentInfo, projectId: string | null) => void;
  defaultId: string;
  onSetDefault: (id: string) => void;
  onChoose: () => void;
  /** DT-17: the Automations page is opened from the sidebar (the optional row of AUTO-023 is T-291). */
  /** Which page (Automations, Model routing) is open over the content column, if any. */
  page: Page | null;
  onPage: (page: Page) => void;
  /** Bump to reload the list after something outside the sidebar made a workspace. */
  refresh: number;
  /** Hands the window the project list and which project owns each workspace folder. */
  onIndex: (projects: Project[], owner: Record<string, string>) => void;
  /** Bumped by Mod+N (workspace.create): opens the name field for the project in front. */
  createRequest: number;
  /** PROJ-038: starts an agent with a first prompt in a workspace just made; `show` brings it in front. */
  onStartIn: (agent: AgentInfo, dir: string, branch: string | null, prompt: string, show: boolean) => void;
  /** PROJ-047: child workspaces nest under their parent unless this is off. */
  nest: boolean;
  onNest: (on: boolean) => void;
};

export default function ProjectsPanel({ openDirs, states, unread, onUnread, settings, onSetting, activeDir, onSelect, onRemoved, agents, launching, onLaunch, defaultId, onSetDefault, onChoose, page, onPage, refresh, onIndex, createRequest, onStartIn, nest, onNest }: Props) {
  const [shutKids, setShutKids] = useState<ReadonlySet<string>>(new Set()); // parent workspaces folded shut (PROJ-047)
  const [projects, setProjects] = useState<Project[]>([]);
  const [plusOpen, setPlusOpen] = useState(false);
  const index = useRef(onIndex);
  index.current = onIndex;
  const [worktrees, setWorktrees] = useState<Record<string, Worktree[]>>({}); // the ones the sidebar shows
  const [hiddenWts, setHiddenWts] = useState<Record<string, Worktree[]>>({}); // PROJ-042: hidden by the user
  const [fresh, setFresh] = useState<Record<string, Worktree[]>>({}); // PROJ-041: made outside Kolux, not yet reviewed
  const [review, setReview] = useState<string | null>(null); // project id whose new-worktree review is open
  const [hiddenPage, setHiddenPage] = useState(0);
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
  const [creating, setCreating] = useState<string | null>(null); // project id whose name field is open; "" with no project yet
  const [pending, setPending] = useState<{ projectId: string; name: string } | null>(null); // the stand-in row while Git works
  const shown = useRef(activeDir); // the workspace in front, read when a create finishes
  shown.current = activeDir;
  const [name, setName] = useState("");
  const [existing, setExisting] = useState(false); // PROJ-030: open a branch that already exists instead of making one
  const [branchList, setBranchList] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  // GIT-067: `dirty` is set once the back end refused because of uncommitted work; the form then asks again.
  const [confirm, setConfirm] = useState<{ projectId: string; path: string; branch: string; dirty?: boolean } | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);
  const [gitVersion, setGitVersion] = useState("");
  const indexed = useRef(""); // the last project list and owner map handed to the window
  const [filterOpen, setFilterOpen] = useState(false);
  const [folded, setFolded] = useState<Set<string>>(new Set()); // group titles folded away
  const seen = useRef<Record<string, AgentState>>({});
  const groupBy = groupFromSetting(settings[GROUP_SETTING]);
  const sortBy = sortFromSetting(settings[SORT_SETTING]);
  // PROJ-022: how new branches begin; read by the backend at create time. T-116 moves it to the Git page.
  const prefixMode = typeof settings.branchPrefix === "string" ? settings.branchPrefix : "user";
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

  const refreshWorktrees = useCallback(async (list: Project[]) => {
    const next: Record<string, Worktree[]> = {};
    const unseen: Record<string, Worktree[]> = {};
    for (const p of list) {
      try {
        next[p.id] = await invoke<Worktree[]>("workspace_list", { projectId: p.id });
        unseen[p.id] = await invoke<Worktree[]>("workspace_unseen", { projectId: p.id });
      } catch (err) {
        next[p.id] = [];
        fail(err);
      }
    }
    setWorktrees(Object.fromEntries(Object.entries(next).map(([id, ws]) => [id, ws.filter((w) => !w.hidden)])));
    setHiddenWts(Object.fromEntries(Object.entries(next).map(([id, ws]) => [id, ws.filter((w) => w.hidden)])));
    setFresh(unseen);
    const owner: Record<string, string> = {};
    for (const p of list) for (const w of next[p.id] ?? []) owner[w.path] = p.id;
    const key = JSON.stringify([list, owner]);
    if (key !== indexed.current) index.current(list, owner);
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
    invoke<Preview | null>("workspace_preview", { name, projectId: creating || null }).then((s) => live && setPreview(s)).catch(fail);
    return () => {
      live = false;
    };
  }, [name, creating]);

  useEffect(() => {
    if (!existing || !creating) return;
    let live = true;
    invoke<string[]>("workspace_branches", { projectId: creating }).then((b) => live && setBranchList(b)).catch(fail);
    return () => {
      live = false;
    };
  }, [existing, creating]);

  // PROJ-007: the new project's main checkout becomes the workspace in front, its worktrees listed.
  const addPath = async (path: string) => {
    if (!path.trim()) return;
    setBusy("adding");
    try {
      const p = await invoke<Project>("project_add", { path });
      say("ok", `${p.name} is a project (${p.path})`);
      setPathDraft("");
      setShowAdd(false);
      await reload();
      const open = openedWorktree(await invoke<Worktree[]>("workspace_list", { projectId: p.id }), p.path);
      if (open) onSelect(open.path, open.branch);
    } catch (err) {
      fail(err);
    } finally {
      setBusy("");
    }
  };

  const browse = async () => {
    try {
      const picked = await open({ directory: true, multiple: true, title: "Choose Git repository folders" });
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
  // ponytail: one create at a time (the field is disabled while Git works); cancelling an
  // overtaken create and removing its half-made checkout waits for a card that needs it.
  // PROJ-038: with a prompt and no agent picked, the default agent runs it, else the first installed.
  const installed = agents.filter((a) => a.installed);
  const fallbackAgent = installed.find((a) => a.id === defaultId) ?? installed[0] ?? null;
  const create = async (project: Project) => {
    const base = baseDraft.trim();
    if (existing ? !base : !name.trim() || preview === null) return;
    const from = shown.current;
    const prompt = promptDraft.trim();
    const agent = agentDraft ? (installed.find((a) => a.id === agentDraft) ?? null) : prompt ? fallbackAgent : null;
    setBusy("creating");
    setPending({ projectId: project.id, name: name.trim() || base });
    setName("");
    setBaseDraft("");
    setPromptDraft("");
    setCreating(null);
    try {
      const wt = existing
        ? await invoke<Created>("workspace_open_branch", { projectId: project.id, branch: base, folder: name.trim() || null })
        : await invoke<Created>("workspace_create", { projectId: project.id, name, base: base || null });
      const extra = [wt.note, ...wt.warnings].filter(Boolean).join(" · ");
      say(extra ? "warn" : "ok", `created ${worktreeLabel(wt)} in ${wt.path} from ${wt.base}${extra ? ` · ${extra}` : ""}`);
      await reload();
      // The agent's tab is the workspace's first; a shell is only opened when no agent runs.
      if (agent) onStartIn(agent, wt.path, wt.branch, prompt, shown.current === from);
      else if (shown.current === from) onSelect(wt.path, wt.branch);
    } catch (err) {
      fail(err);
    } finally {
      setPending(null);
      setBusy("");
    }
  };

  // The project in front: the one whose workspace is shown, else the first; "" with none yet.
  const projectInFront = () => projects.find((p) => (worktrees[p.id] ?? []).some((w) => activeDir !== null && same(activeDir, w.path)))?.id ?? projects[0]?.id ?? "";
  useEffect(() => {
    if (createRequest > 0) setCreating(projectInFront());
  }, [createRequest]);
  const nameField = (p: Project | null) => (
    <div className="sb-form" data-create={p?.id ?? ""}>
      <label className="check">
        <input type="checkbox" aria-label="open an existing branch" checked={existing} onChange={(e) => setExisting(e.target.checked)} />
        Open an existing branch
      </label>
      <input aria-label="workspace name" className="field" placeholder={existing ? "folder name (optional: the branch name)" : "name, e.g. Fix login"} value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => (e.key === "Enter" && p ? create(p) : e.key === "Escape" && setCreating(null))} />
      <div className="preview">{existing ? (baseDraft.trim() ? `checks out ${baseDraft.trim()} as it is, its commits kept` : "Pick the branch to open.") : previewSentence(name, preview, p)}</div>
      <input aria-label={existing ? "existing branch" : "start from"} className="field" list={existing ? "branch-list" : undefined} placeholder={existing ? "branch, e.g. feat/x" : p?.base ? `start from: ${p.base} (saved)` : "start from: the default branch"} value={baseDraft} onChange={(e) => setBaseDraft(e.target.value)} onKeyDown={(e) => (e.key === "Enter" && p ? create(p) : e.key === "Escape" && setCreating(null))} />
      <datalist id="branch-list">
        {branchList.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <select aria-label="agent" className="field" value={agentDraft} onChange={(e) => setAgentDraft(e.target.value)}>
        <option value="">{promptDraft.trim() && fallbackAgent ? `${fallbackAgent.name} (default)` : "No agent: a shell"}</option>
        {installed.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <textarea aria-label="first prompt" className="field multi" placeholder="first prompt for the agent (optional)" value={promptDraft} onChange={(e) => setPromptDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setCreating(null)} />
      <div className="btn-row">
        <button className="btn" onClick={() => p && create(p)} disabled={busy !== "" || !p || (existing ? !baseDraft.trim() : preview === null)}>
          Create
        </button>
        <button className="btn" onClick={() => setCreating(null)}>
          Cancel
        </button>
      </div>
    </div>
  );

  const remove = async () => {
    if (!confirm) return;
    setBusy("removing");
    try {
      await invoke("workspace_remove", { projectId: confirm.projectId, path: confirm.path, force: confirm.dirty === true });
      onRemoved(confirm.path);
      say("ok", `removed ${confirm.branch} and its folder`);
      setConfirm(null);
      await reload();
    } catch (err) {
      if (!confirm.dirty && String(err).includes("has uncommitted changes")) setConfirm({ ...confirm, dirty: true });
      else fail(err);
    } finally {
      setBusy("");
    }
  };

  // PROJ-042: hide or show one worktree; the poll shows the change, this just does not wait for it.
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
  // ponytail: the global and per-source visibility defaults (and the link to them) are T-107-e / T-108.
  const PAGE = 10;
  const hiddenList = (p: Project) => {
    const all = hiddenWts[p.id] ?? [];
    const pages = Math.max(1, Math.ceil(all.length / PAGE));
    const at = Math.min(hiddenPage, pages - 1);
    return (
      <>
        <label>Hidden worktrees ({all.length})</label>
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
    return (
      <div key={w.path} data-worktree={worktreeLabel(w)} data-depth={depth}>
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
          <span className={`dot ${info.state}${isActive(w) ? " live" : ""}`} role="img" aria-label={isActive(w) || info.state !== "idle" ? info.state : "idle"} />
          <span className="name">{worktreeLabel(w)}</span>
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
                setConfirm({ projectId: p.id, path: w.path, branch: worktreeLabel(w) });
              }}
            >
              <Close size={11} />
            </button>
          )}
        </div>
        {asking && (
          <div className="sb-form warn">
            {confirm.dirty ? (
              <>
                <b>{confirm.branch}</b> has uncommitted changes. Remove it anyway? That work is lost.
              </>
            ) : (
              <>
                Remove <b>{confirm.branch}</b> and its folder? Its branch is deleted too, unless the workspace was opened on a branch that already existed.
              </>
            )}
            <div className="btn-row">
              <button className="btn danger" onClick={remove} disabled={busy !== ""}>
                {busy === "removing" ? "Removing…" : confirm.dirty ? "Discard and remove" : "Remove"}
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
    pending?.projectId === p.id && (
      <div className="sess pending" data-pending={pending.name} aria-busy="true">
        <span className="dot" role="img" aria-label="creating" />
        <span className="name">{pending.name}</span>
        <span className="hint">creating…</span>
      </div>
    );

  return (
    <div className="sidebar-wrap">
      <aside className="sidebar" aria-label="Sidebar">
        <nav className="sb-nav">
          <button className="row" title="Tasks (not built yet)">
            <span className="ic">
              <List />
            </span>
            Tasks
          </button>
          <button className="row" title="Artifacts (not built yet)">
            <span className="ic">
              <FileCode />
            </span>
            Artifacts
          </button>
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
            <button className="ib" title="Add a project: choose folders that hold a Git repository" onClick={browse} disabled={busy !== ""}>
              <FolderPlus size={13} />
            </button>
            <button className="ib" title="New workspace: a branch in its own folder" aria-pressed={creating !== null} onClick={() => setCreating(creating === null ? projectInFront() : null)}>
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
              <input aria-label="project folder" className="field" placeholder="path to a folder with a .git" value={pathDraft} onChange={(e) => setPathDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPath(pathDraft)} />
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
              <label>Branch prefix</label>
              <select aria-label="branch prefix" className="field" value={prefixMode} onChange={(e) => onSetting("branchPrefix", e.target.value)}>
                <option value="user">Git user name, e.g. txais-xiong/</option>
                <option value="custom">Custom text</option>
                <option value="none">None: the bare name</option>
              </select>
              {prefixMode === "custom" && <input aria-label="custom branch prefix" className="field" placeholder="e.g. tx/" defaultValue={String(settings.branchPrefixCustom ?? "")} onBlur={(e) => onSetting("branchPrefixCustom", e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />}
              <label className="check">
                <input type="checkbox" checked={nest} onChange={(e) => onNest(e.target.checked)} />
                Nest child workspaces under their parent
              </label>
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
          {projects.length === 0 && !showAdd && <div className="sb-hint">No projects yet. Use the folder button above to add one that holds a Git repository.</div>}

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
                      <span className={`dot ${infoOf(main).state}${isActive(main) ? " live" : ""}`} role="img" aria-label={infoOf(main).state} />
                      <span className="name">{worktreeLabel(main)}</span>
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
                      {fresh[p.id].length} new worktree{fresh[p.id].length === 1 ? "" : "s"}
                    </button>
                  )}
                  {review === p.id && (
                    <div className="sb-form" data-review={p.id}>
                      <label>New worktrees in {p.name}</label>
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
            onChoose={() => {
              setPlusOpen(false);
              onChoose();
            }}
            busy={launching}
            style={{ left: 16, bottom: 56 }}
            onClose={() => setPlusOpen(false)}
            onPick={(a) => {
              setPlusOpen(false);
              onLaunch(a, projects.length === 1 ? projects[0].id : null);
            }}
          />
        )}
        <div className="sb-foot">
          <button className="ib" title={`Add a project by path, or change the workspaces folder${gitVersion ? ` · ${gitVersion}` : ""}`} aria-pressed={showAdd} onClick={() => setShowAdd((s) => !s)}>
            <Gear />
          </button>
          <button className="ib" title="Automations" aria-pressed={page === "automations"} onClick={() => onPage("automations")}>
            <Clock />
          </button>
          {/* SET-028: until Settings > Agents exists (T-036, T-054), model routing opens from here. */}
          <button className="ib" title="Model routing: the model and effort for each worker tier" aria-pressed={page === "routing"} onClick={() => onPage("routing")}>
            <Sliders size={14} />
          </button>
          <button className="ib" title="Help (not built yet)">
            <Help />
          </button>
          <button className="upd" title="Updates (not built yet)">
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
    </div>
  );
}
