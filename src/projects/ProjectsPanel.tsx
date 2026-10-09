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
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { orderWorktrees, placeFieldAction, previewSentence, worktreeLabel, type Created, type PlaceInfo, type Preview, type Project, type Worktree } from "./model";
import { Bell, ChevronDown, Close, FileCode, FolderPlus, Gear, Help, List, Plus, Rail, Refresh, Rocket, Sliders, Target } from "../chrome/icons";
import PlusMenu, { type AgentInfo } from "../launch/PlusMenu";
import { KeyText } from "../keys/KeymapContext";

type Props = {
  /** Folders a pane is open in: those workspace rows show a live dot and a count. */
  openDirs: string[];
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
  /** Bump to reload the list after something outside the sidebar made a workspace. */
  refresh: number;
  /** Hands the window the project list and which project owns each workspace folder. */
  onIndex: (projects: Project[], owner: Record<string, string>) => void;
  /** Bumped by Mod+N (workspace.create): opens the name field for the project in front. */
  createRequest: number;
  /** PROJ-038: starts an agent with a first prompt in a workspace just made; `show` brings it in front. */
  onStartIn: (agent: AgentInfo, dir: string, branch: string | null, prompt: string, show: boolean) => void;
};

export default function ProjectsPanel({ openDirs, activeDir, onSelect, onRemoved, agents, launching, onLaunch, defaultId, onSetDefault, onChoose, refresh, onIndex, createRequest, onStartIn }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [plusOpen, setPlusOpen] = useState(false);
  const index = useRef(onIndex);
  index.current = onIndex;
  const [worktrees, setWorktrees] = useState<Record<string, Worktree[]>>({});
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
  const [preview, setPreview] = useState<Preview | null>(null);
  // GIT-067: `dirty` is set once the back end refused because of uncommitted work; the form then asks again.
  const [confirm, setConfirm] = useState<{ projectId: string; path: string; branch: string; dirty?: boolean } | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);
  const [gitVersion, setGitVersion] = useState("");

  const say = (kind: "ok" | "warn" | "error", text: string) => setMessage({ kind, text });
  const fail = (err: unknown) => say("error", String(err));

  const refreshWorktrees = useCallback(async (list: Project[]) => {
    const next: Record<string, Worktree[]> = {};
    for (const p of list) {
      try {
        next[p.id] = await invoke<Worktree[]>("workspace_list", { projectId: p.id });
      } catch (err) {
        next[p.id] = [];
        fail(err);
      }
    }
    setWorktrees(next);
    const owner: Record<string, string> = {};
    for (const p of list) for (const w of next[p.id] ?? []) owner[w.path] = p.id;
    index.current(list, owner);
  }, []);

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
      const main = (await invoke<Worktree[]>("workspace_list", { projectId: p.id })).find((w) => w.isMain);
      if (main) onSelect(main.path, main.branch);
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
    if (!name.trim() || preview === null) return;
    const from = shown.current;
    const prompt = promptDraft.trim();
    const agent = agentDraft ? (installed.find((a) => a.id === agentDraft) ?? null) : prompt ? fallbackAgent : null;
    const base = baseDraft.trim();
    setBusy("creating");
    setPending({ projectId: project.id, name });
    setName("");
    setBaseDraft("");
    setPromptDraft("");
    setCreating(null);
    try {
      const wt = await invoke<Created>("workspace_create", { projectId: project.id, name, base: base || null });
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
      <input aria-label="workspace name" className="field" placeholder="name, e.g. Fix login" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => (e.key === "Enter" && p ? create(p) : e.key === "Escape" && setCreating(null))} />
      <div className="preview">{previewSentence(name, preview, p)}</div>
      <input aria-label="start from" className="field" placeholder={p?.base ? `start from: ${p.base} (saved)` : "start from: the default branch"} value={baseDraft} onChange={(e) => setBaseDraft(e.target.value)} onKeyDown={(e) => (e.key === "Enter" && p ? create(p) : e.key === "Escape" && setCreating(null))} />
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
        <button className="btn" onClick={() => p && create(p)} disabled={busy !== "" || preview === null || !p}>
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

  const same = (a: string, b: string) => a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();
  const openCount = (w: Worktree) => openDirs.filter((d) => same(d, w.path)).length;
  const isActive = (w: Worktree) => openCount(w) > 0;
  const isSelected = (w: Worktree) => activeDir !== null && same(activeDir, w.path);

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
            <button className="ib" title="Filter (not built yet)">
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
            </div>
          )}

          <datalist id="used-dirs">
            {place.used.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          {creating === "" && nameField(null)}
          {projects.length === 0 && !showAdd && <div className="sb-hint">No projects yet. Use the folder button above to add one that holds a Git repository.</div>}

          {projects.map((p) => {
            const list = orderWorktrees(worktrees[p.id] ?? []);
            const main = list.find((w) => w.isMain);
            const others = list.filter((w) => !w.isMain);
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
                  <button className={`branch${isSelected(main) ? " sel" : ""}`} onClick={() => onSelect(main.path, main.branch)} title={`Show ${main.path}`}>
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
                {opening && nameField(p)}
                {pending?.projectId === p.id && (
                  <div className="sess pending" data-pending={pending.name} aria-busy="true">
                    <span className="dot" role="img" aria-label="creating" />
                    <span className="name">{pending.name}</span>
                    <span className="hint">creating…</span>
                  </div>
                )}
                {others.map((w) => {
                  const asking = confirm?.path === w.path;
                  const active = isActive(w);
                  return (
                    <div key={w.path} data-worktree={worktreeLabel(w)}>
                      <div className={`sess${isSelected(w) ? " sel" : ""}`} role="button" tabIndex={0} onClick={() => onSelect(w.path, w.branch)} onKeyDown={(e) => e.key === "Enter" && onSelect(w.path, w.branch)} title={`Show ${w.path}`}>
                        <span className={`dot${active ? " live" : ""}`} role="img" aria-label={active ? "terminal open here" : "idle"} />
                        <span className="name">{worktreeLabel(w)}</span>
                        {!asking && (
                          <button
                            className="ib"
                            title="Remove this workspace: deletes its branch and folder"
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
                              Delete branch <b>{confirm.branch}</b> and its folder?
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
                })}
              </div>
            );
          })}

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
