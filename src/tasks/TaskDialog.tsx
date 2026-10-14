// GIT-050: the preview dialog for one issue or pull request, opened by clicking it in Tasks: its
// description, timeline, labels and assignees. The description shows GitHub's latest version (read
// again every 15 seconds while the dialog is open) unless it is being edited, and an edit keeps its
// unsaved draft until it is saved or cancelled.
// GIT-053 (T-314-b): typing @ in the description editor offers this repository's people.
// ponytail: the description shows as plain text, not rendered markdown; assignee edits, close /
// reopen / comment and opening a workspace come with T-231-c, the full pull request page with T-232-c.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { Close } from "../chrome/icons";
import MentionField from "./MentionField";
import { eventLine, type Task, type TaskDetail, type TaskLabel, taskKind } from "./model";
import type { Person } from "./repoFacts";

const FRESH_MS = 15_000;

export default function TaskDialog({ task, host, onClose, onLabels }: { task: Task; host: string; onClose: () => void; onLabels: (labels: TaskLabel[]) => void }) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [offer, setOffer] = useState<TaskLabel[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const tell = useRef(onLabels);
  tell.current = onLabels;
  const args = { host, repo: task.repo, number: task.number };

  useEffect(() => {
    const read = () =>
      invoke<TaskDetail>("scm_task_detail", args)
        .then((d) => {
          setDetail(d);
          setError(null);
          tell.current(d.labels);
        })
        .catch((e) => setError(String(e)));
    void read();
    invoke<TaskLabel[]>("scm_repo_labels", { host, repo: task.repo })
      .then(setOffer)
      .catch(() => setOffer([]));
    // GIT-053: the people @ offers are this item's own repository's, on this item's host.
    let live = true;
    setPeople([]);
    invoke<Person[]>("github_people", { host, repo: task.repo }).then(
      (p) => live && setPeople(p),
      () => live && setPeople([]),
    );
    const timer = setInterval(read, FRESH_MS);
    box.current?.focus();
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [task.url]);

  const labels = (add: string[], remove: string[]) => {
    setBusy(true);
    invoke<TaskLabel[]>("scm_task_labels", { ...args, add, remove })
      .then((l) => {
        setDetail((d) => d && { ...d, labels: l });
        onLabels(l);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };
  const save = () => {
    if (draft === null) return;
    setBusy(true);
    invoke<TaskDetail>("scm_task_body", { ...args, body: draft })
      .then((d) => {
        setDetail((x) => x && { ...x, body: d.body, updated: d.updated });
        setDraft(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const have = detail?.labels ?? task.labels;
  const more = offer.filter((o) => !have.some((h) => h.name === o.name));
  const state = detail?.state ?? task.state;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} className="auto-dialog task-dialog" role="dialog" aria-modal="true" aria-label={`${taskKind(task)} ${task.title}`} onKeyDown={(e) => e.key === "Escape" && draft === null && onClose()}>
        <div className="auto-dialog-head">
          <h2>
            <span className={`task-state ${task.kind} ${state}`}>{task.draft ? "draft" : state}</span> {detail?.title || task.title}
          </h2>
          <span className="tasks-kind">
            {taskKind(task)} · {task.repo}
          </span>
          <a className="btn" href={task.url} target="_blank" rel="noreferrer">
            Open on GitHub
          </a>
          <button className="ib" title="Close" onClick={onClose}>
            <Close />
          </button>
        </div>
        {error && (
          <div className="note warn" role="status">
            {error}
          </div>
        )}
        <div className="auto-dialog-body">
          <div className="auto-dialog-main task-main">
            <div className="task-sect">
              <span className="task-cap">Description</span>
              {draft === null ? (
                <button className="btn" disabled={!detail} onClick={() => setDraft(detail?.body ?? "")}>
                  Edit
                </button>
              ) : (
                <>
                  <button className="btn primary" disabled={busy} onClick={save}>
                    Save
                  </button>
                  <button className="btn" disabled={busy} onClick={() => setDraft(null)}>
                    Cancel
                  </button>
                </>
              )}
            </div>
            {draft !== null ? (
              <MentionField className="task-body-edit" label="Description" value={draft} onChange={setDraft} people={people} />
            ) : (
              <div className="task-body" data-task-body>
                {detail === null ? "Loading…" : detail.body || <span className="muted">No description.</span>}
              </div>
            )}
            <span className="task-cap">Timeline</span>
            <ul className="task-timeline">
              {(detail?.events ?? []).map((e, i) => (
                <li key={i} className={e.kind}>
                  <span className="task-line">{eventLine(e)}</span>
                  <span className="tasks-when">{e.at.slice(0, 10)}</span>
                </li>
              ))}
              {detail && detail.events.length === 0 && <li className="muted">Nothing has happened yet.</li>}
            </ul>
          </div>
          <div className="auto-dialog-side">
            <span className="task-cap">Labels</span>
            <div className="task-labels">
              {have.map((l) => (
                <span key={l.name} className="tasks-label" style={l.color ? { borderColor: `#${l.color}` } : undefined}>
                  {l.color && <i style={{ background: `#${l.color}` }} />}
                  {l.name}
                  <button className="task-x" title={`Remove ${l.name}`} disabled={busy} onClick={() => labels([], [l.name])}>
                    ×
                  </button>
                </span>
              ))}
              {have.length === 0 && <span className="muted">None</span>}
            </div>
            <select className="field" aria-label="Add a label" value="" disabled={busy || more.length === 0} onChange={(e) => e.target.value && labels([e.target.value], [])}>
              <option value="">{more.length ? "Add a label…" : "No more labels"}</option>
              {more.map((l) => (
                <option key={l.name} value={l.name}>
                  {l.name}
                </option>
              ))}
            </select>
            <span className="task-cap">Assignees</span>
            <div className="task-labels">{(detail?.assignees ?? task.assignees).map((a) => <span key={a} className="tasks-who">@{a}</span>)}</div>
            {(detail?.assignees ?? task.assignees).length === 0 && <span className="muted">No one</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
