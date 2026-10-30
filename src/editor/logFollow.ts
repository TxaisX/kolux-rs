// EDIT-026 (T-317): a log tab that keeps adding lines as the file grows. A partly written last line is held
// back until its newline arrives; if the file was emptied, rotated or cut short, the view starts again from the top.

/** What the tab should show next given what it shows now and the file's text, or null when nothing changed.
 * `reset`: the file no longer continues what was shown, so the view starts over (the caller scrolls to the end). */
export function followStep(shown: string, disk: string): { text: string; reset: boolean } | null {
  const whole = disk.slice(0, disk.lastIndexOf("\n") + 1);
  if (whole === shown) return null;
  return { text: whole, reset: !whole.startsWith(shown) };
}

/** T-317: the files the Explorer row menu offers to follow (Follow log): a name ending in .log, in any letter case.
 * ponytail: .log names only; widen this test if other growing files (a .jsonl transcript) need following. */
export const isLog = (path: string): boolean => /\.log$/i.test(path);
