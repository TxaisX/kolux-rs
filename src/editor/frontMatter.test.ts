import { describe, expect, it } from "vitest";
import { richChange, splitFront } from "./frontMatter";
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
