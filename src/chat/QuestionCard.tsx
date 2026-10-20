// Native chat, the question card (CHAT-022; T-327-b): the agent's multiple-choice question with its options (one or
// several may be picked), a free-text answer, and for several questions a step count with Next, Skip and Submit.
// While the answer is typed into the agent the card says Sending… with Cancel and locks the choices. The rules are in
// question.ts.
import { useState } from "react";
import type { Pick, QuestionCard as Card } from "./question";

export function QuestionCard({ card, sending, onSubmit, onCancel, onDismiss }: { card: Card; sending: boolean; onSubmit: (picks: Pick[]) => void; onCancel: () => void; onDismiss: () => void }) {
  const total = card.questions.length;
  const [step, setStep] = useState(0);
  const [picks, setPicks] = useState<Pick[]>(() => card.questions.map(() => ({ chosen: [], text: "" })));
  const q = card.questions[Math.min(step, total - 1)];
  const at = Math.min(step, total - 1);
  const now = picks[at] ?? { chosen: [], text: "" };
  const set = (p: Pick) => setPicks((all) => all.map((x, i) => (i === at ? p : x)));
  const toggle = (i: number) => {
    const has = now.chosen.includes(i);
    set({ chosen: q.multi ? (has ? now.chosen.filter((n) => n !== i) : [...now.chosen, i]) : has ? [] : [i], text: "" });
  };
  const last = at === total - 1;
  const answered = (p: Pick) => p.chosen.length > 0 || p.text.trim().length > 0;
  const skip = () => {
    set({ chosen: [], text: "", skipped: true });
    if (!last) setStep(at + 1);
  };
  return (
    <div className="chat-permission chat-question" role="dialog" aria-label="Question from the agent">
      <div className="chat-permission-head">
        <strong>{q.header || "Question"}</strong>
        {total > 1 && <span className="chat-question-step">Step {at + 1} of {total}</span>}
        <button type="button" className="chat-permission-x" aria-label="Dismiss" title="Dismiss (answer in the terminal)" onClick={onDismiss} disabled={sending}>
          ×
        </button>
      </div>
      <p className="chat-question-text">{q.question}</p>
      <div className="chat-question-options" role={q.multi ? "group" : "radiogroup"} aria-label={q.question}>
        {q.options.map((o, i) => (
          <label key={i} className="chat-question-option">
            <input type={q.multi ? "checkbox" : "radio"} name={"q" + at} checked={now.chosen.includes(i)} disabled={sending} onChange={() => toggle(i)} />
            <span>
              {o.label}
              {o.description && <small> {o.description}</small>}
            </span>
          </label>
        ))}
      </div>
      <input className="chat-question-other" type="text" placeholder="Or type an answer" aria-label="Type an answer" value={now.text} disabled={sending} onChange={(e) => set({ chosen: [], text: e.target.value })} />
      <div className="chat-permission-actions">
        {sending ? (
          <>
            <span role="status">Sending…</span>
            <button type="button" onClick={onCancel}>Cancel</button>
          </>
        ) : (
          <>
            {at > 0 && <button type="button" onClick={() => setStep(at - 1)}>Back</button>}
            {!last && <button type="button" onClick={() => setStep(at + 1)} disabled={!answered(now)}>Next</button>}
            {!last && <button type="button" onClick={skip}>Skip</button>}
            {last && <button type="button" className="allow" onClick={() => onSubmit(picks)} disabled={!picks.some(answered)}>Submit</button>}
          </>
        )}
      </div>
    </div>
  );
}
