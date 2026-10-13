// SAFE-002..004: the plan review sheet. It slides in from the right with the plan as formatted
// markdown, one block per section; each block takes comments, a note sits at the foot, and the
// two answers are Approve and Request changes. SAFE-006: a plan cut to fit says so; SAFE-007: once
// the pane stops waiting on this plan, the sheet says the prompt closed and both answers go dead.
import { useEffect, useMemo, useState } from "react";
import { renderMarkdown } from "../editor/PreviewPane";
import { canRequest, planSections, sectionQuote, type PlanDraft } from "./planReview";

type Props = {
  title: string;
  plan: string;
  draft: PlanDraft;
  onDraft: (d: PlanDraft) => void;
  onApprove: () => void;
  onRequest: () => void;
  onClose: () => void;
  /** SAFE-006: the plan was trimmed to fit its status update. */
  cut?: boolean;
  /** SAFE-007: the pane no longer waits on this plan. */
  closed?: boolean;
};

export default function PlanSheet({ title, plan, draft, onDraft, onApprove, onRequest, onClose, cut = false, closed = false }: Props) {
  const sections = useMemo(() => planSections(plan), [plan]);
  const [writing, setWriting] = useState<number | null>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !e.isComposing && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const add = (i: number) => {
    const s = sections[i];
    if (!text.trim()) return;
    onDraft({ ...draft, comments: [...draft.comments, { id: `${s.start}-${Date.now()}`, start: s.start, end: s.end, quote: sectionQuote(s.text), text: text.trim() }] });
    setText("");
    setWriting(null);
  };
  const range = (s: { start: number; end: number }) => (s.start === s.end ? `Line ${s.start}` : `Lines ${s.start}-${s.end}`);
  const count = draft.comments.length;
  return (
    <aside className="plan-sheet" role="dialog" aria-label={`Review the plan for ${title}`}>
      <header className="plan-sheet-head">
        <h3>Review the plan</h3>
        <span className="muted">{title}</span>
        <button className="btn" onClick={onClose} title="Close (Esc); comments are kept for this plan">
          Close
        </button>
      </header>
      {closed && (
        <div className="note warn plan-sheet-note" role="status">
          The plan prompt has closed, so this plan can no longer be approved or sent back. Your comments are kept.
        </div>
      )}
      {cut && <div className="note plan-sheet-note">This plan is too long to show whole, so it is cut short here. The whole plan is in the terminal.</div>}
      <div className="plan-sheet-body">
        {sections.length === 0 && <p className="muted">The plan is empty.</p>}
        {sections.map((s, i) => (
          <section key={s.start} className="plan-block" aria-label={range(s)}>
            <div className="plan-block-head">
              <span className="muted">{range(s)}</span>
              {writing !== i && (
                <button className="btn link" onClick={() => (setWriting(i), setText(""))}>
                  Add comment
                </button>
              )}
            </div>
            <div className="md-preview" onClick={(e) => (e.target as HTMLElement).closest("a") && e.preventDefault()} dangerouslySetInnerHTML={{ __html: renderMarkdown(s.text) }} />
            {draft.comments
              .filter((c) => c.start === s.start)
              .map((c) => (
                <div key={c.id} className="plan-comment">
                  <span>{c.text}</span>
                  <button className="btn link" onClick={() => onDraft({ ...draft, comments: draft.comments.filter((x) => x.id !== c.id) })}>
                    Remove
                  </button>
                </div>
              ))}
            {writing === i && (
              <div className="plan-write">
                <textarea autoFocus aria-label={`Comment on ${range(s)}`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && add(i)} />
                <button className="btn" disabled={!text.trim()} onClick={() => add(i)}>
                  Add
                </button>
                <button className="btn link" onClick={() => setWriting(null)}>
                  Cancel
                </button>
              </div>
            )}
          </section>
        ))}
      </div>
      <footer className="plan-sheet-foot">
        <textarea aria-label="Overall feedback" placeholder="Overall feedback (optional)" value={draft.note} onChange={(e) => onDraft({ ...draft, note: e.target.value })} />
        <div className="plan-sheet-actions">
          <button className="btn" disabled={closed || !canRequest(draft.comments, draft.note)} onClick={onRequest}>
            {count > 0 ? `Request changes (${count})` : "Request changes"}
          </button>
          <button className="btn primary" disabled={closed} onClick={onApprove}>
            Approve
          </button>
        </div>
      </footer>
    </aside>
  );
}
