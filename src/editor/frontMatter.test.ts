import { describe, expect, it } from "vitest";
import { keepRaw, richChange, splitFront } from "./frontMatter";
import { roundTrip, unsupported } from "./markdown";

// EDIT-019 (T-177): front matter stays out of the rich view and untouched on disk.
const note = "---\ntitle: Plan\ntags: [a, b]\n---\n# Heading\n\nOne paragraph with a word.\n";

describe("splitting front matter", () => {
  it("takes YAML between --- lines and TOML between +++ lines", () => {
    const y = splitFront(note);
    expect([y.kind, y.front, y.body]).toEqual(["yaml", "---\ntitle: Plan\ntags: [a, b]\n---\n", "# Heading\n\nOne paragraph with a word.\n"]);
    const t = splitFront('+++\ntitle = "x"\n+++\nbody\n');
    expect([t.kind, t.front, t.body]).toEqual(["toml", '+++\ntitle = "x"\n+++\n', "body\n"]);
  });

  it("front + body is always the whole text, with Windows line ends too", () => {
    for (const s of [note, note.replace(/\n/g, "\r\n"), "plain\n", "---\nnever closed\n", "---\n---\n", "---\na: 1\n...\nrest", ""]) {
      const p = splitFront(s);
      expect(p.front + p.body).toBe(s);
    }
    expect(splitFront(note.replace(/\n/g, "\r\n")).kind).toBe("yaml");
  });

  it("an unclosed --- opening, a rule in the middle, or a fence not at the start is note text", () => {
    expect(splitFront("---\nnever closed\n").kind).toBeNull();
    expect(splitFront("intro\n---\na: 1\n---\n").kind).toBeNull();
    expect(splitFront("# Title\n").front).toBe("");
  });

  it("the rich view takes a note with front matter once the front matter is out of its text", () => {
    expect(unsupported(note)).toBe("it has front matter");
    expect(unsupported(splitFront(note).body)).toBeNull();
  });
});

describe("one word changed in the rich view", () => {
  it("changes only that span, after the front matter", () => {
    const edited = "# Heading\n\nOne paragraph with a changed word.";
    const c = richChange(note, edited)!;
    const after = note.slice(0, c.from) + c.insert + note.slice(c.to);
    expect(after).toBe(note.replace("a word", "a changed word"));
    expect(c.from).toBeGreaterThan(splitFront(note).front.length);
  });

  it("opening and leaving the note unchanged is no change at all", () => {
    const body = splitFront(note).body;
    expect(richChange(note, roundTrip(body)!)).toBeNull();
    expect(richChange(note, body)).toBeNull();
  });

  it("a note with Windows line ends changes in one line only (the buffer joins lines with \n)", () => {
    // The buffer text has \n whatever the file uses; CodeMirror writes the file's own \r\n back,
    // so one changed span is one changed line in git diff.
    const lines = note.split("\n");
    const c = richChange(note, "# Heading\n\nOne paragraph with a changed word.")!;
    const out = (note.slice(0, c.from) + c.insert + note.slice(c.to)).split("\n");
    expect(out.length).toBe(lines.length);
    expect(out.filter((l, i) => l !== lines[i])).toHaveLength(1);
  });
});

describe("row 134: a note starting with a byte order mark", () => {
  it("still has its front matter kept out of the rich view", () => {
    const bom = "\uFEFF" + note;
    const s = splitFront(bom);
    expect([s.kind, s.front, s.body]).toEqual(["yaml", "\uFEFF---\ntitle: Plan\ntags: [a, b]\n---\n", "# Heading\n\nOne paragraph with a word.\n"]);
    const c = richChange(bom, "# Heading\n\nOne paragraph with a new word.")!;
    expect((bom.slice(0, c.from) + c.insert + bom.slice(c.to)).startsWith(s.front)).toBe(true);
  });
});

describe("row 135: a rich edit rewrites only what the user changed", () => {
  const apply = (t: string, c: { from: number; to: number; insert: string } | null) => (c ? t.slice(0, c.from) + c.insert + t.slice(c.to) : t);

  it("bytes the rich view spells its own way stay as the file had them, before and after the edit", () => {
    const body = "* one\n* two\n\nSome _soft_ words.\n\n* last\n";
    const prev = roundTrip(body)!;
    expect(prev).not.toBe(body.trimEnd()); // the rich view respells this note
    const out = roundTrip("* one\n* two\n\nSome _soft_ words and more.\n\n* last\n")!;
    const c = richChange(body, out, prev)!;
    expect(apply(body, c)).toBe("* one\n* two\n\nSome _soft_ words and more.\n\n* last\n");
    expect(c.insert).toBe(" and more");
  });

  it("typing at the very end keeps the file's last line end after the new text", () => {
    // Round 4: the edit is checked with its neighbour block too, so `prev` is the rich view's real spelling.
    const prev = roundTrip("* a\n* b\n\ntext here\n")!;
    expect(keepRaw("* a\n* b\n\ntext here\n", prev.replace("text here", "text here!"), prev)).toBe("* a\n* b\n\ntext here!\n");
  });

  it("an edit that touches a respelt bit replaces that bit, and only that bit", () => {
    // Round 3: `prev` is the rich view's real spelling (it keeps `*` bullets), not a made-up "- a\n- b".
    const items = roundTrip("* a\n* b\n")!;
    expect(keepRaw("* a\n* b\n", items + "c", items)).toBe("* a\n* bc\n");
    // The second item made plain text: its marker goes, however the file spelt it.
    expect(keepRaw("* a\n* b\n", items.replace("* b", "b"), items)).toBe("* a\nb\n");
  });

  it("with no earlier spelling it falls back to the whole rich text, as before", () => {
    expect(keepRaw("x\n", "y", undefined)).toBe("y");
  });
});

// Row 94 (EDIT-019): the Preview tab shows the front matter as its own block (PreviewPane renders splitFront(...).body).
describe("preview of a note with front matter", () => {
  it("whole-note markdown turns the front matter into a rule and a heading; the body alone does not", async () => {
    const { marked } = await import("marked");
    const whole = marked.parse(note, { async: false });
    expect(whole).toContain("<hr");
    expect(whole).toContain("<h2");
    const { front, body } = splitFront(note);
    const page = marked.parse(body, { async: false });
    expect(page).not.toContain("<hr");
    expect(page).not.toContain("<h2");
    expect(page).toContain("<h1");
    expect(front).toBe("---\ntitle: Plan\ntags: [a, b]\n---\n");
  });
});
