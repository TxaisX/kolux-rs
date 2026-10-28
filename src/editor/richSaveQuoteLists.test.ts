import { describe, expect, it } from "vitest";
import { richChange, splitFront } from "./frontMatter";
import { roundTrip, unsupported } from "./markdown";

// Row 937 (r12 review) blind spot: richSaveInvariant.ts reads a blockquote as one unit, so its list checks do not look inside a quote.
// Each edit below changes a list inside a quote; the save must be exactly the same line edit made in the file, or be refused.
const NOTES: [string, string][] = [
  ["bullets", "> - item alpha\n> - item bravo\n> - item charlie\n\nTail para here.\n"],
  ["ordered", "> 1. item alpha\n> 2. item bravo\n> 3. item charlie\n\nTail para here.\n"],
  ["nested", "> - item alpha\n>   - sub bravo\n>   - sub charlie\n> - item delta\n\nTail para here.\n"],
  ["after a quote line", "> intro line\n> - item alpha\n> - item bravo\n\nTail para here.\n"],
  ["a list above and below", "- top one\n- top two\n\n> - item alpha\n> - item bravo\n\n- low one\n- low two\n\nTail para here.\n"],
  ["loose list above", "- top one\n\n- top two\n\n> - item alpha\n> - item bravo\n\nTail para here.\n"],
  ["front matter", "---\ntitle: q\n---\n> - item alpha\n> - item bravo\n> - item charlie\n"],
  ["no final newline", "> - item alpha\n> - item bravo\n> - item charlie"],
];

const ITEM = /^(\s*(?:> ?)*\s*)([-*+]|\d+[.)]) (.*)$/;

type Op = { name: string; view: (l: string[], i: number, m: RegExpExecArray) => string[]; file: (l: string[], i: number, m: RegExpExecArray) => string[] };
const OPS: Op[] = [
  { name: "add after", view: (l, i, m) => [...l.slice(0, i + 1), `${m[1]}${m[2]} new item`, ...l.slice(i + 1)], file: (l, i, m) => [...l.slice(0, i + 1), `${m[1]}${m[2]} new item`, ...l.slice(i + 1)] },
  { name: "delete", view: (l, i) => [...l.slice(0, i), ...l.slice(i + 1)], file: (l, i) => [...l.slice(0, i), ...l.slice(i + 1)] },
  { name: "split", view: (l, i, m) => [...l.slice(0, i), `${m[1]}${m[2]} ${m[3].split(" ")[0]}`, `${m[1]}${m[2]} ${m[3].split(" ").slice(1).join(" ")}`, ...l.slice(i + 1)], file: (l, i, m) => [...l.slice(0, i), `${m[1]}${m[2]} ${m[3].split(" ")[0]}`, `${m[1]}${m[2]} ${m[3].split(" ").slice(1).join(" ")}`, ...l.slice(i + 1)] },
  { name: "join with line above", view: (l, i, m) => [...l.slice(0, i - 1), `${l[i - 1]} ${m[3]}`, ...l.slice(i + 1)], file: (l, i, m) => [...l.slice(0, i - 1), `${l[i - 1]} ${m[3]}`, ...l.slice(i + 1)] },
];

describe("a list inside a blockquote: every edit saves the same line edit, or is refused", () => {
  const cases: [string, string, string, number][] = [];
  for (const [name, body] of NOTES) for (const nl of ["\n", "\r\n"]) for (const op of OPS) cases.push([`${name} / ${op.name} / ${nl === "\n" ? "LF" : "CRLF"}`, body, nl, OPS.indexOf(op)]);

  it.each(cases)("%s", (_label, body0, nl, opAt) => {
    const op = OPS[opAt];
    const body = body0.replace(/\n/g, nl);
    const inner = splitFront(body).body.replace(/\r\n/g, "\n");
    expect(unsupported(inner), "the probe note must open in the rich view").toBeNull();
    const viewText = roundTrip(inner);
    const prev = viewText!;
    const vl = prev.split("\n");
    const fl = body.split(nl);
    // Items of the view's text and of the file line up one for one (these notes are tight and spelt as the view spells them).
    const at = vl.map((l, i) => (ITEM.exec(l)?.[1].includes(">") && !(op.name === "join with line above" && !ITEM.test(vl[i - 1] ?? "")) ? i : -1)).filter((i) => i >= 0);
    let tried = 0;
    for (const i of at) {
      const vm = ITEM.exec(vl[i])!;
      // The matching file line: the same text. A line that is not found is skipped (the notes above are spelt as the view spells them, so this holds).
      const fi = fl.findIndex((x) => x.replace(/\r$/, "") === vl[i]);
      if (fi < 0) continue;
      const fm = ITEM.exec(fl[fi].replace(/\r$/, ""))!;
      const viewOut = roundTrip(op.view(vl, i, vm).join("\n"));
      if (viewOut === null || viewOut === prev || roundTrip(viewOut) !== viewOut) continue;
      const expected = op.file(fl.map((x) => x.replace(/\r$/, "")), fi, fm).join(nl);
      tried++;
      let refused = 0;
      const c = richChange(body, viewOut, prev, () => refused++);
      const saved = c ? body.slice(0, c.from) + c.insert + body.slice(c.to) : body;
      const why = `${JSON.stringify(body)}\nprev=${JSON.stringify(prev)}\nout=${JSON.stringify(viewOut)}\nsaved=${JSON.stringify(saved)}\nexpected=${JSON.stringify(expected)}`;
      if (refused) expect(saved, why).toBe(body);
      else expect(saved, why).toBe(expected);
    }
    expect(tried).toBeGreaterThan(0);
  });
});
