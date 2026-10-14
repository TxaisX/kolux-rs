// Native chat, the message box at the foot of the chat (CHAT-017; T-327): grows to about eight
// lines, Enter sends and Shift+Enter starts a new line, the arrows step through earlier messages,
// and the unsent draft is kept per pane. The rules live in composer.ts.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";
import { addHistory, draftOf, historyOf, keepDraft, keyAction, linesFor, stepHistory } from "./composer";

export type ComposerHandle = { focus: () => void };

type Props = {
  paneKey: number;
  /** The session has a live terminal to type into. */
  live: boolean;
  onSend: (text: string) => void;
};

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ paneKey, live, onSend }, ref) {
  const [text, setText] = useState(() => draftOf(paneKey));
  // The history index shown; history.length means the draft itself.
  const [at, setAt] = useState(() => historyOf(paneKey).length);
  const draft = useRef(text);
  const box = useRef<HTMLTextAreaElement>(null);
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

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const before = el.value.slice(0, el.selectionStart);
    const after = el.value.slice(el.selectionEnd);
    const act = keyAction({ key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode }, !before.includes("\n"), !after.includes("\n"));
    if (act === "send") {
      e.preventDefault();
      if (!live || !text.trim()) return;
      addHistory(paneKey, text);
      onSend(text);
      setText("");
      draft.current = "";
      keepDraft(paneKey, "");
      setAt(historyOf(paneKey).length);
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
    </div>
  );
});
