// The CodeMirror side of the open-file buffers (EDIT-001, T-603). buffers.ts holds the documents and
// carries no CodeMirror, because the first frame loads it (FloatingLayer asks isDirty, the window asks
// keyOf and baseName); this module is what the editor and the buffers' tests import, and loading it
// installs the five values the store cannot make itself: the annotation that marks Kolux's own change
// and the read of it, the undo grouping a reload gets (isolateHistory, compared by identity with the
// history extension, so it must come from this package, never a copy), the line separator compartment a
// view splits on, and the text split into lines the way that view splits it.
import { Annotation, Compartment, EditorState, Text, type Extension } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { useCodeMirror } from "./buffers";

/** Marks a change Kolux made itself (a copy from the twin view, a reload), not the user's typing. */
export const synced = Annotation.define<boolean>();

// A file with Windows line ends is shown and saved with them. The editor splits text on its separator only, so
// T-603: the separator sits in a compartment that a reload using other line ends throughout switches (replaceAll).
const lineEnds = new Compartment();
const lineEndOf = (text: string) => (text.includes("\r\n") ? "\r\n" : "\n");
/** The line separator of an editor showing `text` (EditorPane, DiffPane). */
export const lineEndsFor = (text: string): Extension => lineEnds.of(EditorState.lineSeparator.of(lineEndOf(text)));
/** T-603 (F01-editor.2): a change worked out on doc.toString() (lines joined with \n), its line breaks as `state` splits them. */
export const withLineBreaks = <C extends { insert: string }>(state: EditorState, c: C): C => ({ ...c, insert: c.insert.replace(/\r?\n/g, state.lineBreak) });

useCodeMirror({
  mark: () => synced.of(true),
  marked: (tr) => !!tr.annotation(synced),
  isolate: () => isolateHistory.of("full"),
  ends: (end) => lineEnds.reconfigure(EditorState.lineSeparator.of(end)),
  lines: (text, end) => Text.of(text.split(end)),
});

// Everything a caller of a buffer needs, from one module: importing this one is what installs the
// CodeMirror values above, so a view can never be attached to a buffer that cannot dispatch to it.
export * from "./buffers";
