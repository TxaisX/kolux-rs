// EDIT-008 (T-282): a huge paste never freezes the window. Up to CHUNK characters go in the way
// CodeMirror pastes on its own; a bigger paste goes in CHUNK at a time, one piece per turn of the
// event loop, so the window keeps drawing and responding (keystrokes and clicks into this editor are
// dropped, not queued, until the paste is in: holdInput; a second paste meanwhile is refused with a
// toast, busyRefusal); past PASTE_LIMIT the paste is refused
// with a toast and the buffer is left as it was. Context-menu Paste fires the same paste event as
// the keyboard, so it takes the same road (whole-line and multi-cursor pastes stay CodeMirror's own
// below CHUNK). A read-only editor is never pasted into. The rich markdown view applies the same
// limit, and turns away a paste over its own 600 KB size limit
// (markdown.ts, refusePaste), since it takes a paste in one go.
import { isolateHistory } from "@codemirror/commands";
import { EditorState, StateEffect, StateField, Transaction, type Extension } from "@codemirror/state";
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
  const size = mb(length) === mb(PASTE_LIMIT) ? "it is just" : `${mb(length)} MB is`;
  return `Paste refused: ${size} over the ${mb(PASTE_LIMIT)} MB limit for one paste. Nothing was pasted.`;
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
 * the paste user event; the rest join it in the undo history (no user event, adjacent, all stamped
 * with the paste's start time `t0` so a slow turn never passes the history's 500 ms grouping
 * delay), and the last closes the group, so one undo takes the whole paste back. */
export function pieceSpec(piece: string, first: boolean, from: number, to: number, last: boolean, t0 = Date.now()) {
  const end = from + piece.length;
  return {
    changes: { from, to, insert: piece },
    selection: { anchor: end },
    effects: setMark.of(last ? null : end),
    scrollIntoView: true,
    annotations: [Transaction.time.of(t0), ...(last ? [isolateHistory.of("after")] : [])],
    ...(first ? { userEvent: "input.paste" } : {}),
  };
}

/** Pastes `text` into `view` a piece per event-loop turn. `done` runs after the last piece. */
export function pasteChunked(view: EditorView, text: string, done?: () => void): void {
  const parts = chunks(text);
  const sel = view.state.selection.main;
  const t0 = Date.now();
  view.dispatch(pieceSpec(parts[0], true, sel.from, sel.to, parts.length === 1, t0));
  let i = 1;
  const step = () => {
    if (i >= parts.length) return done?.();
    const at = view.state.field(pasteMark, false);
    if (at === null || at === undefined) return done?.();
    try {
      view.dispatch(pieceSpec(parts[i], false, at, at, i === parts.length - 1, t0));
    } catch (e) {
      // FIX-2 (council FS-3): a piece that throws must not leave the editor holding input forever.
      // FIX-3 (council AFTER 6): on a view that is gone the release throws too; the paste still ends
      // and the piece's own error is the one reported.
      try {
        view.dispatch({ effects: setMark.of(null) });
      } catch {
        // nothing is left to hold input
      }
      done?.();
      throw e;
    }
    i += 1;
    setTimeout(step, 0);
  };
  setTimeout(step, 0);
}

/** While a chunked paste is under way, the user's own edits and clicks wait it out (dropped): a
 * keystroke at the mark would land inside the paste, and a caret move would split its undo step.
 * The pieces carry no user event and pass. A paste takes well under a second per few MB. */
export const holdInput = EditorState.transactionFilter.of((tr) =>
  tr.startState.field(pasteMark, false) != null && tr.annotation(Transaction.userEvent) !== undefined ? [] : tr,
);

/** The toast for a paste made while an earlier chunked paste is still going in. */
export const busyRefusal = "Paste refused: the last paste is still going in. Nothing was pasted.";

/** One paste event. FIX-2 (council FS-3): while a chunked paste is under way a second paste is refused
 * out loud (holdInput would drop a small one silently, and a big one would start a second run of
 * pieces that interleaves with the first). True when the event was handled here. */
export function handlePaste(event: ClipboardEvent, view: EditorView, refuse: (text: string) => void): boolean {
  if (view.state.field(pasteMark, false) != null && !view.state.readOnly) {
    event.preventDefault();
    refuse(busyRefusal);
    return true;
  }
  const text = event.clipboardData?.getData("text/plain") ?? "";
  const v = verdict(text.length, view.state.readOnly);
  if (v === "native") return false;
  event.preventDefault();
  if (v === "refused") refuse(refusal(text.length));
  if (v === "chunked") pasteChunked(view, text);
  return true;
}

/** The editor extension: `refuse` shows the refusal toast. */
export function pasteGuard(refuse: (text: string) => void): Extension {
  return [pasteMark, holdInput, EditorView.domEventHandlers({ paste: (event, view) => handlePaste(event, view, refuse) })];
}
