// T-231-d (GIT-046): create a GitHub issue from Tasks. The draft is saved as it is typed (settings
// key tasksIssueDraft) and comes back when the dialog is opened again; one too long for settings is
// held in memory for the run.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { actionError } from "./issueActions";
import type { Task } from "./model";
import { draftFrom, draftToSave, type IssueDraft, openDraft, withRepo } from "./newIssue";

let held: IssueDraft | null = null;

const names = (s: string) => [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))];

export default function NewIssueDialog(p: {
  host: string;
  targets: string[];
  saved: unknown;
  save: (patch: Record<string, unknown>) => Promise<unknown> | void;
  factsRepo: string;
  labels: string[];
  people: string[];
  onClose: () => void;
  onCreated: (t: Task) => void;
}) {
  const [d, setD] = useState<IssueDraft>(() => openDraft(held ?? draftFrom(p.saved), p.targets));
  const [labelText, setLabelText] = useState(d.labels.join(", "));
  const [peopleText, setPeopleText] = useState(d.assignees.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const out = draftToSave(d);
  useEffect(() => box.current?.focus(), []);
  useEffect(() => {
    held = d;
    if (out === "too-long") return;
    const t = setTimeout(() => void p.save({ tasksIssueDraft: out }), 400);
    return () => clearTimeout(t);
  }, [d]);

  const put = (next: IssueDraft) => {
    setD(next);
    setLabelText(next.labels.join(", "));
    setPeopleText(next.assignees.join(", "));
  };
  const create = () => {
    setBusy(true);
    setError(null);
    invoke<{ number: number; url: string; title: string }>("github_issue_create", { host: p.host, repo: d.repo, title: d.title, body: d.body, labels: d.labels, assignees: d.assignees })
      .then((c) => {
        held = null;
        void p.save({ tasksIssueDraft: null });
        p.onCreated({ kind: "issue", number: c.number, title: c.title || d.title.trim(), url: c.url, repo: d.repo, state: "open", draft: false, labels: d.labels.map((name) => ({ name, color: "" })), assignees: d.assignees, updated: new Date().toISOString(), checks: null });
      })
      .catch((e) => setError(actionError(String(e), "create")))
      .finally(() => setBusy(false));
  };
  const facts = d.repo === p.factsRepo;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div ref={box} tabIndex={-1} className="auto-dialog task-dialog" role="dialog" aria-modal="true" aria-label="New issue" data-new-issue onKeyDown={(e) => e.key === "Escape" && p.onClose()}>
        <div className="auto-dialog-head">
          <h2>New issue</h2>
          <button className="task-x" title="Close (the draft is kept)" onClick={p.onClose}>
            ×
          </button>
        </div>
        <label>
          Repository{" "}
          <select className="field" value={d.repo} onChange={(e) => put(withRepo(d, e.target.value))}>
            {p.targets.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <input className="field" aria-label="Title" placeholder="Title" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
        <textarea className="field" aria-label="Description" placeholder="Description (Markdown)" rows={8} value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} />
        <input className="field" aria-label="Labels" placeholder="Labels, comma separated" list="new-issue-labels" value={labelText} onChange={(e) => setLabelText(e.target.value)} onBlur={() => setD({ ...d, labels: names(labelText) })} />
        <input className="field" aria-label="Assignees" placeholder="Assignees (logins), comma separated" list="new-issue-people" value={peopleText} onChange={(e) => setPeopleText(e.target.value)} onBlur={() => setD({ ...d, assignees: names(peopleText) })} />
        <datalist id="new-issue-labels">{facts && p.labels.map((l) => <option key={l} value={l} />)}</datalist>
        <datalist id="new-issue-people">{facts && p.people.map((l) => <option key={l} value={l} />)}</datalist>
        {out === "too-long" && (
          <div className="tasks-count" data-draft-memory>
            This draft is too long to keep after Kolux closes; it is kept until then, and creating the issue still works.
          </div>
        )}
        {error && (
          <div className="tasks-warn" role="alert">
            {error}
          </div>
        )}
        <button className="btn primary" disabled={busy || !d.title.trim() || !d.repo} onClick={create}>
          {busy ? "Creating…" : "Create issue"}
        </button>
      </div>
    </div>
  );
}
