// EDIT-008 (T-282): a huge paste never freezes the window. Up to CHUNK characters go in the way
// CodeMirror pastes on its own; a bigger paste goes in CHUNK at a time, one piece per turn of the
// event loop, so the window keeps drawing and taking input; past PASTE_LIMIT the paste is refused
// with a toast and the buffer is left as it was. Context-menu Paste fires the same paste event as
// the keyboard, so it takes the same road (whole-line and multi-cursor pastes stay CodeMirror's own
// below CHUNK). A read-only editor is never pasted into. The rich markdown view applies the same
// limit (markdown.ts, refusePaste).
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** Pastes up to this many characters go in at once. */
export const CHUNK = 256 * 1024;
/** The hard limit for one paste, in characters. */
export const PASTE_LIMIT = 32 * 1024 * 1024;

export type Verdict = "ignore" | "native" | "chunked" | "refused";

/** What a paste of `length` characters does in an editor that is (or is not) read-only. */
export function verdict(length: number, readOnly: boolean): Verdict {
  if (readOnly) return "ignore";
  if (length > PASTE_LIMIT) return "refused";
  return length > CHUNK ? "chunked" : "native";
}

const mb = (n: number) => (n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "");

/** The toast for a refused paste. */
export function refusal(length: number): string {
  return `Paste refused: ${mb(length)} MB is over the ${mb(PASTE_LIMIT)} MB limit for one paste. Nothing was pasted.`;
}

/** `text` in pieces of at most `size` characters; a piece never ends between the two halves of an
 * emoji (a surrogate pair) or between the CR and LF of one Windows line end. */
export function chunks(text: string, size = CHUNK): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(at + size, text.length);
    if (end < text.length && end - at > 1) {
      const last = text.charCodeAt(end - 1);
      if ((last >= 0xd800 && last <= 0xdbff) || (last === 13 && text.charCodeAt(end) === 10)) end -= 1;
    }
    out.push(text.slice(at, end));
    at = end;
  }
  return out;
}

/** Where the next piece goes, kept true through edits made while a chunked paste is under way. */
const setMark = StateEffect.define<number | null>();
export const pasteMark = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setMark)) return e.value;
    return value === null ? null : tr.changes.mapPos(value, 1);
  },
});

/** The transactions of a chunked paste, as specs: the first replaces the main selection and carries
 * the paste user event; the rest join it in the undo history (no user event, adjacent), so one undo
 * takes the whole paste back. */
export function pieceSpec(piece: string, first: boolean, from: number, to: number, last: boolean) {
  const end = from + piece.length;
  return {
    changes: { from, to, insert: piece },
    selection: { anchor: end },
    effects: setMark.of(last ? null : end),
    scrollIntoView: true,
    ...(first ? { userEvent: "input.paste" } : {}),
  };
}

/** Pastes `text` into `view` a piece per event-loop turn. `done` runs after the last piece. */
export function pasteChunked(view: EditorView, text: string, done?: () => void): void {
  const parts = chunks(text);
  const sel = view.state.selection.main;
  view.dispatch(pieceSpec(parts[0], true, sel.from, sel.to, parts.length === 1));
  let i = 1;
  const step = () => {
    if (i >= parts.length) return done?.();
    const at = view.state.field(pasteMark, false);
    if (at === null || at === undefined) return done?.();
    view.dispatch(pieceSpec(parts[i], false, at, at, i === parts.length - 1));
    i += 1;
    setTimeout(step, 0);
  };
  setTimeout(step, 0);
}

/** The editor extension: `refuse` shows the refusal toast. */
export function pasteGuard(refuse: (text: string) => void): Extension {
  return [
    pasteMark,
    EditorView.domEventHandlers({
      paste(event, view) {
        const text = event.clipboardData?.getData("text/plain") ?? "";
        const v = verdict(text.length, view.state.readOnly);
        if (v === "native") return false;
        event.preventDefault();
        if (v === "refused") refuse(refusal(text.length));
        if (v === "chunked") pasteChunked(view, text);
        return true;
      },
    }),
  ];
}
