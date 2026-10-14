// GIT-050: the preview dialog for one issue or pull request, opened by clicking it in Tasks: its
// description, timeline, labels and assignees. The description shows GitHub's latest version (read
// again every 15 seconds while the dialog is open) unless it is being edited, and an edit keeps its
// unsaved draft until it is saved or cancelled.
// GIT-053 (T-314-b): typing @ in the description editor offers this repository's people.
// GIT-047 (T-231-c): an issue can be closed (completed, not planned, duplicate), reopened and commented on.
// ponytail: the description shows as plain text, not rendered markdown; assignee edits and opening a
// workspace come later, the full pull request page with T-232-c.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { Close } from "../chrome/icons";
import { type IssueAction, runAction } from "./issueActions";
import MentionField from "./MentionField";
import { duplicateQuery, eventLine, issueNumber, type Task, type TaskDetail, type TaskLabel, type TaskPage, taskKind } from "./model";
import type { Person } from "./repoFacts";

const FRESH_MS = 15_000;

export default function TaskDialog({ task, host, onClose, onLabels, onState }: { task: Task; host: string; onClose: () => void; onLabels: (labels: TaskLabel[]) => void; onState: (state: string) => void }) {
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

  const refresh = () =>
    invoke<TaskDetail>("scm_task_detail", args)
      .then((d) => {
        setDetail(d);
        onState(d.state);
      })
      .catch((e) => setError(String(e)));

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
            {task.kind === "issue" && <IssueActions host={host} task={task} state={state} title={detail?.title || task.title} onDone={refresh} />}
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

/** GIT-047: close an issue (completed, not planned, or a duplicate of another number), reopen it, and
 * comment on it. A duplicate target is checked by github.rs before anything is sent; issues sharing
 * words of the title are offered as targets. */
function IssueActions({ host, task, state, title, onDone }: { host: string; task: Task; state: string; title: string; onDone: () => Promise<unknown> }) {
  const [reason, setReason] = useState("completed");
  const [dup, setDup] = useState("");
  const [like, setLike] = useState<Task[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const args = { host, repo: task.repo, number: task.number };
  useEffect(() => {
    const q = reason === "duplicate" ? duplicateQuery(task.repo, title) : null;
    if (!q) return setLike([]);
    let live = true;
    invoke<TaskPage>("scm_tasks_search", { host, queries: [q], page: 1 })
      .then((p) => live && setLike(p.items.filter((t) => t.kind === "issue" && t.number !== task.number).slice(0, 5)))
      .catch(() => live && setLike([]));
    return () => {
      live = false;
    };
  }, [reason, host, task.repo, task.number, title]);
  // FIX-1 (council FS 2): busy until the refreshed issue is back; a timeout says the write may have landed.
  const run = (what: IssueAction, send: Promise<unknown>, after?: () => void) => void runAction({ send, refresh: onDone, after, setBusy, setError, what });
  const dupNumber = issueNumber(dup);
  const close = () => {
    if (reason === "duplicate" && dupNumber === null) return setError("Give the number of the issue this one duplicates, such as 12 or #12.");
    run("close", invoke("github_issue_state", { ...args, open: false, reason, duplicateOf: reason === "duplicate" ? dupNumber : null }));
  };
  return (
    <div className="task-issue" data-issue-actions>
      {error && (
        <div className="note warn" role="status">
          {error}
        </div>
      )}
      <div className="task-sect">
        {state === "open" ? (
          <>
            <select className="field" aria-label="Close as" value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)}>
              <option value="completed">Close as completed</option>
              <option value="not_planned">Close as not planned</option>
              <option value="duplicate">Close as duplicate</option>
            </select>
            {reason === "duplicate" && <input className="field" aria-label="Duplicate of" placeholder="Duplicate of #" value={dup} disabled={busy} onChange={(e) => setDup(e.target.value)} />}
            <button className="btn" disabled={busy} onClick={close}>
              Close issue
            </button>
          </>
        ) : (
          <button className="btn" disabled={busy} onClick={() => run("reopen", invoke("github_issue_state", { ...args, open: true, reason: "", duplicateOf: null }))}>
            Reopen issue
          </button>
        )}
      </div>
      {state === "open" && reason === "duplicate" && like.length > 0 && (
        <div className="task-labels" role="group" aria-label="Possible duplicates">
          {like.map((t) => (
            <button key={t.number} className="btn" title={t.title} onClick={() => setDup(`#${t.number}`)}>
              #{t.number} {t.title.length > 40 ? `${t.title.slice(0, 40)}…` : t.title}
            </button>
          ))}
        </div>
      )}
      <textarea className="field task-comment" aria-label="Comment" placeholder="Leave a comment" value={comment} disabled={busy} onChange={(e) => setComment(e.target.value)} />
      <button className="btn primary" disabled={busy || !comment.trim()} onClick={() => run("comment", invoke("github_issue_comment", { ...args, body: comment }), () => setComment(""))}>
        Comment
      </button>
    </div>
  );
}
