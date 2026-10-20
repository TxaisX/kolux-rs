// Native chat, the message box at the foot of the chat (CHAT-017; T-327): grows to about eight
// lines, Enter sends and Shift+Enter starts a new line, the arrows step through earlier messages,
// and the unsent draft is kept per pane. The rules live in composer.ts.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";
import { addHistory, draftOf, historyOf, keepDraft, keyAction, linesFor, stepHistory } from "./composer";
import { buttonMode, stopArmed } from "./stop";

export type ComposerHandle = { focus: () => void };

type Props = {
  paneKey: number;
  /** The session has a live terminal to type into. */
  live: boolean;
  /** CHAT-022: why sending is held back for now (the agent is asking in its terminal); the draft can still be written. */
  blocked?: string;
  /** A note that does not hold the box (the last message was too long). */
  note?: string;
  /** False when nothing was sent: the box keeps the text. */
  onSend: (text: string) => boolean;
  /** CHAT-018: a turn is under way, so the button beside the box reads Stop and `onStop` interrupts the agent. */
  working?: boolean;
  onStop?: () => void;
};

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ paneKey, live, blocked, note, onSend, working = false, onStop }, ref) {
  const [text, setText] = useState(() => draftOf(paneKey));
  // The history index shown; history.length means the draft itself.
  const [at, setAt] = useState(() => historyOf(paneKey).length);
  const draft = useRef(text);
  const box = useRef<HTMLTextAreaElement>(null);
  // CHAT-018: when this box last sent, so a quick second click on Send is never taken as Stop.
  const sentAt = useRef<number | null>(null);
  useImperativeHandle(ref, () => ({ focus: () => box.current?.focus() }), []);

  useEffect(() => {
    const t = draftOf(paneKey);
    setText(t);
    draft.current = t;
    setAt(historyOf(paneKey).length);
  }, [paneKey]);

  const change = (t: string) => {
    setText(t);
    draft.current = t;
    keepDraft(paneKey, t);
    setAt(historyOf(paneKey).length);
  };

  const submit = () => {
    if (!live || blocked || !text.trim()) return;
    sentAt.current = Date.now();
    if (!onSend(text)) return;
    addHistory(paneKey, text);
    setText("");
    draft.current = "";
    keepDraft(paneKey, "");
    setAt(historyOf(paneKey).length);
    box.current?.focus();
  };
  const mode = buttonMode(working, !!blocked);
  const click = () => {
    if (mode === "send") return submit();
    if (stopArmed(sentAt.current, Date.now())) onStop?.();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const before = el.value.slice(0, el.selectionStart);
    const after = el.value.slice(el.selectionEnd);
    const act = keyAction({ key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode }, !before.includes("\n"), !after.includes("\n"));
    if (act === "send") {
      e.preventDefault();
      submit();
    } else if (act === "older" || act === "newer") {
      const history = historyOf(paneKey);
      if (history.length === 0) return;
      e.preventDefault();
      const next = stepHistory(history, at, act);
      setAt(next);
      setText(next === history.length ? draft.current : history[next]);
    } else if (act === "escape") {
      // CHAT-017: Escape never reaches the agent from the box (it would interrupt it).
      e.stopPropagation();
    }
  };

  return (
    <div className="chat-composer">
      {(blocked ?? note) && (
        <div className="chat-asking" role="status">
          {blocked ?? note}
        </div>
      )}
      <textarea
        ref={box}
        className="chat-box"
        aria-label="Message"
        rows={linesFor(text)}
        value={text}
        placeholder={live ? "Message the agent. Enter sends, Shift+Enter starts a new line." : "This session has no live terminal. Switch back to the terminal to reconnect."}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="button" className={`chat-send${mode === "stop" ? " stop" : ""}`} aria-label={mode === "stop" ? "Stop" : "Send"} disabled={mode === "send" ? !live || !!blocked || !text.trim() : !onStop} onClick={click}>
        {mode === "stop" ? "Stop" : "Send"}
      </button>
    </div>
  );
});
