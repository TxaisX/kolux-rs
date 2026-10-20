// EDIT-038 (T-317): starting a file search takes its first query from the editor in front: the selection, or the
// word the caret rests on. A selection over several lines is joined onto one line (the box holds one).

/** The query for `doc` with the selection `from`..`to` (equal when it is only a caret). */
export function seedText(doc: string, from: number, to: number): string {
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  if (a !== b)
    return doc
      .slice(a, b)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ")
      .slice(0, 200);
  const word = /[\p{L}\p{N}_$]/u;
  let s = a;
  let e = a;
  while (s > 0 && word.test(doc[s - 1])) s--;
  while (e < doc.length && word.test(doc[e])) e++;
  return doc.slice(s, e);
}

const sources = new Map<number, () => string>();
let front: number | null = null;

/** Each editor tab registers how to read its own seed; the one last in front answers `currentSeed`. */
export const seedSources = {
  set: (id: number, get: () => string) => void sources.set(id, get),
  delete: (id: number) => (sources.delete(id), void (front === id && (front = null))),
  focus: (id: number) => void (front = id),
};

export const currentSeed = (): string => (front === null ? "" : (sources.get(front)?.() ?? ""));
