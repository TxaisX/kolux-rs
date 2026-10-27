// Row 94 round 11: the last check of a rich-view save. Placement can be wrong in ways nobody has listed yet, so the
// saved body must also pass two checks that do not care how it was placed: (a) no byte outside the edit's window
// changed, and (b) no list the edit did not reach changed its loose/tight state, marker or gaps. A save that fails
// either is refused, so the note stays as it was.
import { Lexer, type Token } from "marked";
import { changeBetween, wordSpans } from "./markdown";

type ListInfo = { depth: number; loose: boolean; key: string; markers: string };
type ItemInfo = { key: string; marker: string; list: number; idx: number; gap: boolean };
type Unit = [number, number];

const spell = (t: string) => t.replace(/_/g, "*");
const markerOf = (raw: string) => {
  const m = /^[ \t]*(?:([-*+])|\d+([.)]))/.exec(raw);
  return m ? (m[1] ?? m[2]) : "?";
};

function sameEnds<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number] {
  let p = 0;
  while (p < a.length && p < b.length && eq(a[p], b[p])) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && eq(a[a.length - 1 - s], b[b.length - 1 - s])) s++;
  return [p, s];
}

type ListToken = Token & { items: (Token & { text: string; tokens: Token[]; raw: string })[]; loose?: boolean };

/** The lists (document order), their items, and the line ranges that are one unit each (an item's own lines, or a top-level block). */
function read(src: string) {
  const md = src.replace(/\r\n/g, "\n");
  const lists: ListInfo[] = [];
  const items: ItemInfo[] = [];
  const units: Unit[] = [];
  const starts = [0];
  for (let i = md.indexOf("\n"); i >= 0; i = md.indexOf("\n", i + 1)) starts.push(i + 1);
  const lineAt = (off: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const span = (s: number, raw: string): Unit => [lineAt(s), lineAt(s + Math.max(0, raw.replace(/\s+$/, "").length - 1))];
  const walk = (ts: Token[], d: number, from: number, top: boolean) => {
    let at = from;
    for (const t of ts) {
      const s = md.indexOf(t.raw, at);
      if (s >= 0) at = s + t.raw.length;
      if (t.type === "list") {
        const l = t as ListToken;
        const marks = l.items.map((x) => markerOf(x.raw));
        const first = l.items.map((x) => spell(String(x.text).split("\n")[0].trim()));
        lists.push({ depth: d, loose: !!l.loose, key: d + "|" + first.join("\u0001"), markers: marks.join("") });
        const li = lists.length - 1;
        let cur = s;
        l.items.forEach((x, i) => {
          items.push({ key: d + "|" + first[i], marker: marks[i], list: li, idx: i, gap: i > 0 && /\n[ \t]*\n$/.test(l.items[i - 1].raw) });
          const st = cur >= 0 ? md.indexOf(x.raw, cur) : -1;
          if (st >= 0) {
            cur = st + x.raw.length;
            const kid = x.tokens.find((k) => k.type === "list");
            const kidAt = kid ? md.indexOf(kid.raw, st) : -1;
            units.push(span(st, kidAt > st ? md.slice(st, kidAt) : x.raw));
          }
          walk(x.tokens, d + 1, st >= 0 ? st : 0, false);
        });
        continue;
      }
      if (top && s >= 0 && t.type !== "space") units.push(span(s, t.raw));
      const k = t as { tokens?: Token[] };
      if (k.tokens && t.type !== "blockquote") walk(k.tokens, d, s >= 0 ? s : at, false);
    }
  };
  // Block tokens only: inline lexing (emphasis, links) is most of the cost and holds no list.
  walk(new Lexer().blockTokens(md.replace(/\r/g, "\n"), []), 0, 0, true);
  return { lists, items, units };
}

type Read = ReturnType<typeof read>;

// A note longer than this is checked in a slice of this many lines on each side of the edit's window: the bytes outside the window
// are the same in both texts, so a cut far from the window reads the same in both and the checks stay valid, at a fraction of the lexing.
const WHOLE_NOTE_LINES = 400;
const MARGIN_LINES = 60;
// Lines the slice may start at or end before: a list item (indented up to three) or any line with no indent.
const CUT = /^ {0,3}([-*+]|\d+[.)])[ \t]|^\S/;

/** Why the saved body `next` must be refused for the view edit `prev` -> `out` made in `body`, or null when it passes. */
export function saveBreaksInvariant(body: string, next: string, prev: string, out: string): string | null {
  if (next === body) return null;
  const e = changeBetween(prev, out);
  if (!e) return null;
  const pw = wordSpans(prev);
  const bw = wordSpans(body);
  if (pw.length !== bw.length) return "the note and the view hold different words";
  const BL = body.split("\n");
  const NL = next.split("\n");
  const before = pw.filter((w) => w.e <= e.from).length;
  const after = pw.filter((w) => w.s >= e.to).length;
  const lineAt = (off: number) => {
    let n = 0;
    for (let i = body.indexOf("\n"); i >= 0 && i < off; i = body.indexOf("\n", i + 1)) n++;
    return n;
  };
  const lo0 = before ? lineAt(bw[before - 1].e - 1) : 0;
  const hi0 = after ? lineAt(bw[bw.length - after].s) : BL.length - 1;
  for (const sliced of BL.length > WHOLE_NOTE_LINES ? [true, false] : [false]) {
    // The slice starts at a line with no indent and ends before one, so it cuts between top-level lines.
    let a = 0;
    let z = BL.length - 1;
    if (sliced) {
      a = Math.max(0, lo0 - MARGIN_LINES);
      while (a > 0 && !CUT.test(BL[a])) a--;
      z = Math.min(BL.length - 1, hi0 + MARGIN_LINES);
      while (z < BL.length - 1 && !CUT.test(BL[z + 1])) z++;
    }
    const B = read(sliced ? BL.slice(a, z + 1).join("\n") : body);
    const unitOf = (l: number): Unit => B.units.filter((u) => u[0] <= l - a && l - a <= u[1]).sort((x, y) => x[1] - x[0] - (y[1] - y[0]))[0] ?? [l - a, l - a];
    const lo = Math.min(lo0, unitOf(lo0)[0] + a);
    const hi = Math.max(hi0, unitOf(hi0)[1] + a);
    // A widened window that reaches the cut needs the whole note.
    if (sliced && ((lo <= a && a > 0) || (hi >= z && z < BL.length - 1))) continue;
    if (!sameOutside(BL, NL, lo, hi)) return `bytes changed outside the edited lines ${lo}-${hi}`;
    const nz = NL.length - 1 - (BL.length - 1 - z);
    return untouchedListsChanged(B, sliced ? NL.slice(a, nz + 1).join("\n") : next, prev, out);
  }
  return null;
}

/** (a) Every line outside lines `lo`-`hi` of `BL` is the same in `NL`, CR included. */
function sameOutside(BL: string[], NL: string[], lo: number, hi: number): boolean {
  const pre = (lim: number) => {
    let p = 0;
    while (p < lim && BL[p] === NL[p]) p++;
    return p;
  };
  const suf = (lim: number) => {
    let q = 0;
    while (q < lim && BL[BL.length - 1 - q] === NL[NL.length - 1 - q]) q++;
    return q;
  };
  const m = Math.min(BL.length, NL.length);
  const p1 = pre(m);
  const q1 = suf(m - p1);
  const q2 = suf(m);
  const p2 = pre(m - q2);
  const ok = (p: number, q: number) => p >= lo && BL.length - q <= hi + 1;
  return ok(p1, q1) || ok(p2, q2);
}

/** (b) A list or item the edit did not touch keeps its loose/tight state, its marker and the gaps between its items,
 *  unless the view's own edit shows that change. */
function untouchedListsChanged(B: Read, next: string, prev: string, out: string): string | null {
  const N = read(next);
  let V: [Read, Read] | null = null;
  const view = () => (V ??= [read(prev), read(out)]);
  // The view edit made this item's marker/gap itself: `out` has the item with the new value and `prev` does not.
  const viewMade = (key: string, field: "marker" | "gap", value: string | boolean) => {
    const [v0, v1] = view();
    const has = (r: Read) => r.items.some((x) => x.key === key && x[field] === value);
    return has(v1) && !has(v0);
  };
  const [lp, ls] = sameEnds(B.lists, N.lists, (a, b) => a.key === b.key);
  const pairs: [number, number][] = [];
  for (let i = 0; i < lp; i++) pairs.push([i, i]);
  for (let i = 1; i <= ls; i++) pairs.push([B.lists.length - i, N.lists.length - i]);
  for (const [bi, ni] of pairs) {
    const a = B.lists[bi];
    const b = N.lists[ni];
    if (a.loose !== b.loose) return `an untouched list went ${a.loose ? "tight" : "loose"}: ${JSON.stringify(a.key.slice(0, 40))}`;
    for (let k = 0; k < a.markers.length; k++) {
      const item = B.items.find((x) => x.list === bi && x.idx === k);
      if (a.markers[k] !== b.markers[k] && !(item && viewMade(item.key, "marker", b.markers[k]))) return `an untouched list changed its markers ${a.markers} to ${b.markers}: ${JSON.stringify(a.key.slice(0, 40))}`;
    }
  }
  // The lists the edit reached: when the view's own loose/tight flags did not change, a tight one must not be saved loose, nor may their number change.
  const bm = B.lists.slice(lp, B.lists.length - ls);
  const nm = N.lists.slice(lp, N.lists.length - ls);
  const suspect = bm.length !== nm.length || bm.some((x, i) => x.depth === nm[i].depth && !x.loose && nm[i].loose);
  if (suspect) {
    const [v0, v1] = view();
    const [vp, vs] = sameEnds(v0.lists, v1.lists, (a, b) => a.key === b.key);
    const w0 = v0.lists.slice(vp, v0.lists.length - vs);
    const w1 = v1.lists.slice(vp, v1.lists.length - vs);
    const viewChanged = w0.length !== w1.length || w0.some((x, i) => x.loose !== w1[i].loose);
    if (!viewChanged) return bm.length !== nm.length ? "the edited lists were split or joined though the view's were not" : "an edited list went loose though the view's did not";
  }
  const [ip, is] = sameEnds(B.items, N.items, (a, b) => a.key === b.key);
  const mi = new Map<number, number>();
  for (let i = 0; i < ip; i++) mi.set(i, i);
  for (let i = 1; i <= is; i++) mi.set(B.items.length - i, N.items.length - i);
  for (const [bj, nj] of mi) {
    const a = B.items[bj];
    const b = N.items[nj];
    if (a.marker !== b.marker && !viewMade(a.key, "marker", b.marker)) return `an untouched item changed its marker ${a.marker} to ${b.marker}: ${JSON.stringify(a.key.slice(0, 40))}`;
    if (!a.idx) continue;
    const bp = B.items.findIndex((x, k) => k < bj && x.list === a.list && x.idx === a.idx - 1);
    const np = mi.get(bp);
    if (bp < 0 || np === undefined) continue;
    const npI = N.items[np];
    if (npI.list !== b.list || npI.idx !== b.idx - 1) continue;
    if (a.gap !== b.gap && !viewMade(a.key, "gap", b.gap)) return `the gap above an untouched item was ${a.gap ? "dropped" : "added"}: ${JSON.stringify(a.key.slice(0, 40))}`;
  }
  // A list that holds an untouched item is not loosened by the save (a list only tightens when an item beside its gap is deleted, and the gap check above covers that),
  // unless the view edit changed how many lists are loose.
  for (const [bj, nj] of mi) {
    const a = B.lists[B.items[bj].list];
    const b = N.lists[N.items[nj].list];
    if (a.loose || !b.loose) continue;
    const loose = (r: Read) => r.lists.filter((l) => l.loose).length;
    const [v0, v1] = view();
    if (loose(v0) === loose(v1)) return `a list holding an untouched item went loose: ${JSON.stringify(a.key.slice(0, 40))}`;
  }
  return null;
}
