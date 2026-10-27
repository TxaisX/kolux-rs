// Row 94 round 13: the rich view spells a nested list with four-space indents, `-` markers and `*x*` emphasis. A structural edit
// (Enter, a split, a first or last sub-item) retypes the touched item in that spelling, which re-indents and respells the sub-items
// beside the edit. Here the retyped lines are matched to the file's own lines instead: a line the edit left alone keeps its bytes,
// and a line it added or changed is written in the view's text with the file's indent, marker and line end.

const MARK = /^([-*+]|\d+[.)])([ \t]+)/;
const FILE_MARK = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)/;

/** A line as the view and the file both read it: indent, marker, emphasis spelling and CR left out. */
const reading = (l: string) => l.replace(/\r$/, "").replace(/^[ \t]*([-*+]|\d+[.)])(?=[ \t])/, "#").trim().replace(/_/g, "*");

const lineCount = (t: string) => t.replace(/\s+$/, "").split("\n").length;

/** `bodyPart` (the file's bytes of a touched block) with the edit `prevPart` -> `outPart` (the view's spelling of the same block) made
 *  in it line by line; null when the lines cannot be matched for sure (the caller then retypes the block in the view's spelling). */
export function keepFileLines(bodyPart: string, prevPart: string, outPart: string): string | null {
  // Only an edit that adds or removes a line inside a nested list: anything else is placed word by word, which keeps every byte.
  if (lineCount(prevPart) === lineCount(outPart) || !/^[ \t]+([-*+]|\d+[.)])[ \t]/m.test(bodyPart) || /^[ \t]*(`{3,}|~{3,})|<\/?details>/im.test(bodyPart + outPart)) return null;
  const tail = /\s*$/.exec(bodyPart)![0];
  const B = bodyPart.slice(0, bodyPart.length - tail.length).split("\n");
  const P = prevPart.replace(/\s+$/, "").split("\n");
  const O = outPart.replace(/\s+$/, "").split("\n");
  if (B.length !== P.length || B.some((l, i) => reading(l) !== reading(P[i]))) return null;
  const crs = B.slice(0, -1).filter((l) => l.endsWith("\r")).length;
  if (crs !== 0 && crs !== B.length - 1) return null;
  let p = 0;
  while (p < P.length && p < O.length && P[p] === O[p]) p++;
  let s = 0;
  while (s < P.length - p && s < O.length - p && P[P.length - 1 - s] === O[O.length - 1 - s]) s++;
  const middle = O.length - s - p;
  if (middle * P.length > 4_000_000) return null;
  const viewIndent = (l: string) => /^ */.exec(l)![0].length;
  // The line of `P` nearest to `i` that `ok` accepts: the view's twin of the line the file spells.
  const twin = (i: number, ok: (j: number) => boolean) => {
    const at = Math.min(i, P.length - 1);
    for (let d = 0; d < P.length; d++) for (const j of d ? [at - d, at + d] : [at]) if (j >= 0 && j < P.length && ok(j)) return j;
    return -1;
  };
  const written: string[] = [];
  for (let i = p; i < O.length - s; i++) {
    const l = O[i];
    const vi = viewIndent(l);
    const text = l.slice(vi);
    if (!text) {
      written.push("");
      continue;
    }
    const mk = MARK.exec(text);
    const same = (j: number) => viewIndent(P[j]) === vi && (MARK.exec(P[j].slice(vi)) !== null) === (mk !== null) && (mk === null || /\d/.test(MARK.exec(P[j].slice(vi))![1]) === /\d/.test(mk[1]));
    const j = vi === 0 && !mk ? -1 : twin(i, same);
    if (j < 0 && (vi > 0 || mk)) return null;
    if (!mk) {
      written.push(j < 0 ? text : /^[ \t]*/.exec(B[j])![0] + text);
      continue;
    }
    const fm = FILE_MARK.exec(B[j]);
    if (!fm) return null;
    const marker = /\d/.test(mk[1]) ? mk[1].replace(/[.)]$/, "") + fm[2].slice(-1) : fm[2];
    written.push(fm[1] + marker + fm[3] + text.slice(mk[0].length));
  }
  const lines = [...B.slice(0, p), ...written, ...B.slice(B.length - s)];
  const cr = crs > 0;
  // The block's own last line end is outside it and stays, so its last line carries no CR.
  const last = lines.length - 1;
  return lines.map((l, i) => (i === last ? l.replace(/\r$/, "") : cr && !l.endsWith("\r") ? l + "\r" : l)).join("\n") + tail;
}
