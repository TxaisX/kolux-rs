// VIEW-010: the Tasks page, opened from the sidebar's Tasks row or the view.tasks shortcut. The
// default preset shows every open issue and pull request. ponytail: presets, search, the repository
// picker, paging, new issue and start-from-item are T-231-b; the preview dialog is T-232-b.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { Refresh } from "../chrome/icons";
import { type Task, taskKind } from "./model";

export default function TasksPage({ repo }: { repo: { dir: string; name: string } | null }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    if (!repo) return;
    setError(null);
    invoke<Task[]>("scm_tasks", { worktree: repo.dir })
      .then(setTasks)
      .catch((e) => setError(String(e)));
  };
  useEffect(load, [repo?.dir]);
  return (
    <div className="autos tasks" data-tasks>
      <div className="autos-bar">
        <h2>Tasks</h2>
        {repo && <span className="tasks-repo">{repo.name} · GitHub · open issues and pull requests</span>}
        <span className="autos-gap" />
        <button className="ib" title="Refresh" disabled={!repo} onClick={load}>
          <Refresh />
        </button>
      </div>
      {!repo ? (
        <div className="autos-none tasks-none">Add a project to see its GitHub issues and pull requests.</div>
      ) : error !== null ? (
        <div className="note warn" role="status">
          {error}
        </div>
      ) : tasks === null ? (
        <div className="autos-none tasks-none">Loading…</div>
      ) : tasks.length === 0 ? (
        <div className="autos-none tasks-none">No open issues or pull requests.</div>
      ) : (
        <ul className="tasks-list">
          {tasks.map((t) => (
            <li key={t.url} title={t.url} data-task={`${t.kind}-${t.number}`}>
              <span className={`dot ${t.kind}${t.draft ? " draft" : ""}`} />
              <span className="tasks-title">{t.title}</span>
              <span className="tasks-kind">{taskKind(t)}</span>
              <span className="tasks-when">{t.updated.slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
