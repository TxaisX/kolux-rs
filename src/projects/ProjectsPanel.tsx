// The sidebar card (design/DESIGN.md section 5): Tasks and Artifacts rows, the Projects header
// with its icon row, Workspaces / Status tabs, then each project with its main checkout and
// workspaces, "Next that needs you", "New session" and the footer row. The working parts are
// T-003's: add a Git folder as a project (type or browse), set where workspace folders live,
// create a workspace (a new branch in its own folder), open a shell in one, remove one again.
// Every action goes to the Rust side; this file only draws the state it gets back.
// T-013: adding a project opens its main checkout (PROJ-007); Mod+N or the header's plus opens
// the name field for the project in front, a stand-in row shows while Git works, and the new
// workspace opens with a shell of its own unless the user moved on meanwhile (PROJ-020).
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { orderWorktrees, previewSentence, worktreeLabel, type Project, type Worktree } from "./model";
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
};

export default function ProjectsPanel({ openDirs, activeDir, onSelect, onRemoved, agents, launching, onLaunch, defaultId, onSetDefault, onChoose, refresh, onIndex, createRequest }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [plusOpen, setPlusOpen] = useState(false);
  const index = useRef(onIndex);
  index.current = onIndex;
  const [worktrees, setWorktrees] = useState<Record<string, Worktree[]>>({});
  const [root, setRoot] = useState("");
  const [rootDraft, setRootDraft] = useState("");
  const [pathDraft, setPathDraft] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [creating, setCreating] = useState<string | null>(null); // project id whose name field is open; "" with no project yet
  const [pending, setPending] = useState<{ projectId: string; name: string } | null>(null); // the stand-in row while Git works
  const shown = useRef(activeDir); // the workspace in front, read when a create finishes
  shown.current = activeDir;
  const [name, setName] = useState("");
  const [safe, setSafe] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ projectId: string; path: string; branch: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [gitVersion, setGitVersion] = useState("");

  const say = (kind: "ok" | "error", text: string) => setMessage({ kind, text });
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

  useEffect(() => {
    invoke<string>("git_version").then(setGitVersion).catch(fail);
    invoke<string>("workspaces_dir_get")
      .then((d) => {
        setRoot(d);
        setRootDraft(d);
      })
      .catch(fail);
  }, []);
  useEffect(() => {
    reload().catch(fail);
  }, [reload, refresh]);

  useEffect(() => {
    if (name.trim() === "") {
      setSafe(null);
      return;
    }
    let live = true;
    invoke<string | null>("workspace_preview", { name }).then((s) => live && setSafe(s)).catch(fail);
    return () => {
      live = false;
    };
  }, [name]);

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

  const saveRoot = async () => {
    try {
      const d = await invoke<string>("workspaces_dir_set", { path: rootDraft });
      setRoot(d);
      setRootDraft(d);
      say("ok", `workspaces go under ${d}`);
    } catch (err) {
      fail(err);
    }
  };

  // PROJ-020: a stand-in row at once, then the workspace opens with a shell of its own; if the
  // user moved to another workspace meanwhile the create finishes without pulling focus back.
  // ponytail: one create at a time (the field is disabled while Git works); cancelling an
  // overtaken create and removing its half-made checkout waits for a card that needs it.
  const create = async (project: Project) => {
    if (!name.trim() || safe === null) return;
    const from = shown.current;
    setBusy("creating");
    setPending({ projectId: project.id, name });
    setName("");
    setCreating(null);
    try {
      const wt = await invoke<Worktree>("workspace_create", { projectId: project.id, name });
      say("ok", `created ${worktreeLabel(wt)} in ${wt.path}`);
      await reload();
      if (shown.current === from) onSelect(wt.path, wt.branch);
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
      <div className="preview">{previewSentence(name, safe, root, p)}</div>
      <div className="btn-row">
        <button className="btn" onClick={() => p && create(p)} disabled={busy !== "" || safe === null || !p}>
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
      await invoke("workspace_remove", { projectId: confirm.projectId, path: confirm.path });
      onRemoved(confirm.path);
      say("ok", `removed ${confirm.branch} and its folder`);
      setConfirm(null);
      await reload();
    } catch (err) {
      fail(err);
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
              <label>Workspaces folder</label>
              <input aria-label="workspaces folder" className="field" value={rootDraft} onChange={(e) => setRootDraft(e.target.value)} />
              <div className="btn-row">
                <button className="btn" onClick={saveRoot} disabled={rootDraft === root}>
                  Save
                </button>
                <button className="btn" onClick={() => setRootDraft("")} title="Empty means the default folder">
                  Use default
                </button>
              </div>
            </div>
          )}

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
                          Delete branch <b>{confirm.branch}</b> and its folder? Uncommitted work there is lost.
                          <div className="btn-row">
                            <button className="btn danger" onClick={remove} disabled={busy !== ""}>
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
