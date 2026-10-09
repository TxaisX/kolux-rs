// The projects sidebar: add a Git folder as a project, set where workspace folders live, create a
// workspace (a new branch in its own folder) and remove one again. Every action goes to the Rust
// side; this file only draws the state it gets back.
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { orderWorktrees, previewSentence, worktreeLabel, type Project, type Worktree } from "./model";

type Props = { onOpenShell: (dir: string) => void };

const field: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "#141a2a", color: "#e6e6e6", border: "1px solid #556", borderRadius: 4, padding: "4px 6px", fontSize: 12 };
const button: React.CSSProperties = { background: "transparent", color: "#e6e6e6", border: "1px solid #556", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: 12 };
const danger: React.CSSProperties = { ...button, borderColor: "#c55", color: "#f99" };

export default function ProjectsPanel({ onOpenShell }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [worktrees, setWorktrees] = useState<Record<string, Worktree[]>>({});
  const [root, setRoot] = useState("");
  const [rootDraft, setRootDraft] = useState("");
  const [pathDraft, setPathDraft] = useState("");
  const [name, setName] = useState("");
  const [safe, setSafe] = useState<string | null>(null);
  const [target, setTarget] = useState<string>("");
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
  }, []);

  const reload = useCallback(async () => {
    const list = await invoke<Project[]>("project_list");
    setProjects(list);
    setTarget((t) => (list.some((p) => p.id === t) ? t : (list[0]?.id ?? "")));
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
    reload().catch(fail);
  }, [reload]);

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

  const addPath = async (path: string) => {
    if (!path.trim()) return;
    setBusy("adding");
    try {
      const p = await invoke<Project>("project_add", { path });
      say("ok", `${p.name} is a project (${p.path})`);
      setPathDraft("");
      setTarget(p.id);
      await reload();
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

  const create = async () => {
    if (!target || !name.trim()) return;
    setBusy("creating");
    try {
      const wt = await invoke<Worktree>("workspace_create", { projectId: target, name });
      say("ok", `created ${worktreeLabel(wt)} in ${wt.path}`);
      setName("");
      await reload();
    } catch (err) {
      fail(err);
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    if (!confirm) return;
    setBusy("removing");
    try {
      await invoke("workspace_remove", { projectId: confirm.projectId, path: confirm.path });
      say("ok", `removed ${confirm.branch} and its folder`);
      setConfirm(null);
      await reload();
    } catch (err) {
      fail(err);
    } finally {
      setBusy("");
    }
  };

  const project = projects.find((p) => p.id === target) ?? null;

  return (
    <aside style={{ width: 300, minWidth: 300, display: "flex", flexDirection: "column", gap: 10, padding: 10, background: "#182238", fontSize: 12, overflowY: "auto", boxSizing: "border-box" }}>
      <div style={{ opacity: 0.6 }}>{gitVersion || "looking for git…"}</div>

      <section>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Workspaces folder</div>
        <input aria-label="workspaces folder" style={field} value={rootDraft} onChange={(e) => setRootDraft(e.target.value)} />
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <button style={button} onClick={saveRoot} disabled={rootDraft === root}>
            Save
          </button>
          <button style={button} onClick={() => setRootDraft("")} title="Empty means the default folder">
            Use default
          </button>
        </div>
      </section>

      <section>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Add project</div>
        <input aria-label="project folder" style={field} placeholder="path to a folder with a .git" value={pathDraft} onChange={(e) => setPathDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPath(pathDraft)} />
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <button style={button} onClick={() => addPath(pathDraft)} disabled={busy !== "" || !pathDraft.trim()}>
            Add
          </button>
          <button style={button} onClick={browse} disabled={busy !== ""}>
            Browse…
          </button>
        </div>
      </section>

      <section>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>New workspace</div>
        <select aria-label="project" style={field} value={target} onChange={(e) => setTarget(e.target.value)} disabled={projects.length === 0}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input aria-label="workspace name" style={{ ...field, marginTop: 4 }} placeholder="name, e.g. Fix login" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} disabled={!project} />
        <div style={{ opacity: 0.7, marginTop: 4, wordBreak: "break-all" }}>{previewSentence(name, safe, root, project)}</div>
        <button style={{ ...button, marginTop: 4 }} onClick={create} disabled={busy !== "" || !project || safe === null}>
          {busy === "creating" ? "Creating…" : "Create"}
        </button>
      </section>

      {message && <div style={{ color: message.kind === "ok" ? "#9f9" : "#f99", wordBreak: "break-all" }}>{message.text}</div>}

      <section style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Projects</div>
        {projects.length === 0 && <div style={{ opacity: 0.6 }}>None yet. Add a folder that holds a Git repository.</div>}
        {projects.map((p) => (
          <div key={p.id} style={{ marginBottom: 8 }}>
            <div title={p.path} style={{ fontWeight: 600, color: "#9cf" }}>
              {p.name}
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: "2px 0 0 8px" }}>
              {orderWorktrees(worktrees[p.id] ?? []).map((w) => {
                const asking = confirm?.path === w.path;
                return (
                  <li key={w.path} data-worktree={worktreeLabel(w)} style={{ padding: "3px 0", borderBottom: "1px solid #223" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ flex: 1 }}>
                        {worktreeLabel(w)} {w.isMain && <span style={{ opacity: 0.6 }}>(main)</span>}
                      </span>
                      <button style={button} onClick={() => onOpenShell(w.path)} title={`Open the terminal in ${w.path}`}>
                        Shell
                      </button>
                      {!w.isMain && !asking && (
                        <button style={danger} onClick={() => setConfirm({ projectId: p.id, path: w.path, branch: worktreeLabel(w) })} disabled={busy !== ""}>
                          Remove
                        </button>
                      )}
                    </div>
                    <div style={{ opacity: 0.5, wordBreak: "break-all" }}>{w.path}</div>
                    {asking && (
                      <div style={{ marginTop: 4, padding: 6, border: "1px solid #c55", borderRadius: 4 }}>
                        Delete branch <b>{confirm.branch}</b> and its folder? Uncommitted work there is lost.
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <button style={danger} onClick={remove} disabled={busy !== ""}>
                            {busy === "removing" ? "Removing…" : "Remove"}
                          </button>
                          <button style={button} onClick={() => setConfirm(null)}>
                            Keep
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </aside>
  );
}
