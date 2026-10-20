// EDIT-028 (T-177): a very big or heavily changed file's diff asks before it draws, instead of
// hanging the tab. Confirming draws it as usual, and saving from it works normally.
export const BIG_LINES = 20000;
export const BIG_CHARS = 2 * 1024 * 1024;

const lines = (s: string): number => {
  if (!s) return 0;
  let n = 1;
  for (let i = s.indexOf("\n"); i >= 0; i = s.indexOf("\n", i + 1)) n++;
  return n;
};

export type Measured = { lines: number; chars: number };
export const measure = (s: { original: string; modified: string }): Measured => ({ lines: Math.max(lines(s.original), lines(s.modified)), chars: s.original.length + s.modified.length });

/** Whether the diff is too big to draw without asking. */
export const needsAsk = (s: { original: string; modified: string }): boolean => {
  const m = measure(s);
  return m.lines > BIG_LINES || m.chars > BIG_CHARS;
};

/** The prompt's sentence. */
export const askText = (name: string, s: { original: string; modified: string }): string => `The diff of ${name} is large (${measure(s).lines.toLocaleString("en-US")} lines), so it has not been drawn. Drawing it may take a while.`;
