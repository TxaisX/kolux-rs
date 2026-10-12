// SET-009: the Shortcuts page's recorder. A key press becomes a chord in the file's spelling
// (COMPAT.md 4.2: Mod is Ctrl on Windows and Linux, Cmd on macOS), and the edits a row makes on
// a command's chord list. Pure, except `recording`, which the window's own shortcut handler reads
// so a chord being recorded does not also run its command.
import { actionById, type Platform } from "./actions";
import { chordToString, normaliseIndexChord, type Chord, type KeyLike } from "./keymap";

export const recording = { on: false };

export type Recorded = { chord: string } | { refused: string } | { cancel: true } | null;

const MODIFIER_CODE = /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/;

/** What one keydown means while recording: a chord, a refusal, Esc (cancel), or null (keep
 *  waiting: a lone modifier, or a held key repeating). */
export function recordKey(e: KeyLike & { repeat?: boolean }, platform: Platform, actionId: string): Recorded {
  if (e.repeat || MODIFIER_CODE.test(e.code)) return null;
  const mac = platform === "darwin";
  if (e.code === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return { cancel: true };
  const key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit[0-9]$/.test(e.code) ? e.code.slice(5) : e.code;
  const c: Chord = { mod: mac ? e.metaKey : e.ctrlKey, ctrl: mac && e.ctrlKey, meta: !mac && e.metaKey, alt: e.altKey, shift: e.shiftKey, key };
  if (!c.mod && !c.ctrl && !c.meta && !c.alt && !(c.shift && key === "Space" && actionId === "terminal.switchInputSource")) {
    return { refused: mac ? "Add Cmd, Ctrl or Option: Shift alone, or no modifier, is not a shortcut." : "Add Ctrl or Alt: Shift alone, or no modifier, is not a shortcut." };
  }
  const chord = chordToString(c);
  return { chord: actionById.get(actionId)?.index ? normaliseIndexChord(chord) : chord };
}

/** Puts `chord` at `index` (index = length adds one), never listing the same chord twice. */
export function editChords(chords: string[], index: number, chord: string): string[] {
  const next = [...chords];
  next[index] = chord;
  return next.filter((c, i) => next.indexOf(c) === i);
}

/** Removes one chord. Removing the one being recorded ends recording; removing another keeps
 *  recording on the chord the user picked. */
export function removeChord(chords: string[], index: number, rec: { index: number } | null): { chords: string[]; recording: { index: number } | null } {
  const next = chords.filter((_, i) => i !== index);
  if (!rec || rec.index === index) return { chords: next, recording: null };
  return { chords: next, recording: { index: rec.index > index ? rec.index - 1 : rec.index } };
}
