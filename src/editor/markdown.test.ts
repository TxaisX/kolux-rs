import { describe, expect, it } from "vitest";
import { changeBetween, isMarkdown, planRich, rewrite, roundTrip, splitFront, unsupported } from "./markdown";

describe("rich markdown view (EDIT-012)", () => {
  it("shows ordinary markdown and keeps every word", () => {
    const md = "# Title\n\nSome **bold** and *italic* text with a [link](https://example.com).\n\n- one\n- two\n\n> quoted\n\n```js\nconst x = 1;\n```\n";
    expect(unsupported(md)).toBeNull();
    const back = roundTrip(md)!;
    expect(back).toContain("# Title");
    expect(back).toContain("**bold**");
    expect(back).toContain("[link](https://example.com)");
  });

  it("names what it cannot show", () => {
    expect(unsupported("| a | b |\n|---|---|\n| 1 | 2 |\n")).toBe("it has tables");
    expect(unsupported("![logo](a.png)\n")).toBe("it has images");
    expect(unsupported("see [x][1]\n\n[1]: https://a.b\n")).toBe("it has reference links");
    expect(unsupported("Title\n=====\n")).toBe("it has underlined headings");
    expect(unsupported("a\n\n---\n\nb\n")).toBe("it has horizontal rules");
  });

  it("does not look for HTML inside code", () => {
    expect(unsupported("Use `<div>` here.\n\n```html\n<p>hi</p>\n```\n")).toBeNull();
  });

  it("task lists survive the trip", () => {
    expect(unsupported("- [ ] open\n- [x] done\n")).toBeNull();
  });

  it("a change is only the span that differs", () => {
    expect(changeBetween("hello world", "hello brave world")).toEqual({ from: 6, to: 6, insert: "brave " });
    expect(changeBetween("abc", "abc")).toBeNull();
    expect(changeBetween("aXc", "ac")).toEqual({ from: 1, to: 2, insert: "" });
    expect(changeBetween("aaa", "aa")).toEqual({ from: 2, to: 3, insert: "" });
  });

  it("knows markdown files by name", () => {
    expect([isMarkdown("C:\r\README.md"), isMarkdown("notes.MARKDOWN"), isMarkdown("main.rs")]).toEqual([true, true, false]);
  });
});

describe("rich editing keeps the untouched parts byte-for-byte (EDIT-019)", () => {
  const note = [
    "---",
    "title: Trip notes",
    "tags: [a, b]",
    "---",
    "# Trip",
    "",
    "This paragraph is",
    "hard wrapped over",
    "three lines.",
    "",
    "Some _italic_ and __bold__ with <b>inline HTML</b> in it.",
    "",
    "<details>",
    "<summary>More</summary>",
    "",
    "Hidden text.",
    "",
    "</details>",
    "",
    "* star one",
    "* star two",
    "",
    "",
    "Last line here.",
    "",
  ].join("\r\n");

  it("front matter in YAML or TOML is kept out of the body", () => {
    expect(splitFront(note).front).toBe("---\r\ntitle: Trip notes\r\ntags: [a, b]\r\n---\r\n");
    expect(splitFront(note).body.startsWith("# Trip")).toBe(true);
    expect(splitFront("+++\ntitle = 'x'\n+++\nBody\n")).toEqual({ front: "+++\ntitle = 'x'\n+++\n", body: "Body\n" });
    expect(splitFront("# No front\n")).toEqual({ front: "", body: "# No front\n" });
    expect(splitFront("---\nnot closed\n")).toEqual({ front: "", body: "---\nnot closed\n" });
  });

  it("front matter, inline HTML and collapsible blocks no longer push a note to source view", () => {
    expect(unsupported(note)).toBeNull();
    expect(unsupported("hi <b>there</b>\n")).toBeNull();
  });

  it("an untouched note writes back exactly as it was", () => {
    const plan = planRich(note)!;
    expect(plan).not.toBeNull();
    expect(plan.base).not.toContain("title:"); // the rich view never shows the front matter
    expect(plan.base).toContain("This paragraph is hard wrapped over three lines."); // one flowing paragraph
    expect(rewrite(plan, plan.base)).toBe(note);
  });

  it("changing one word changes a single line on disk", () => {
    const plan = planRich(note)!;
    const out = rewrite(plan, plan.base.replace("Last line here.", "Last word here."));
    const a = note.split("\r\n");
    const b = out.split("\r\n");
    expect(b.length).toBe(a.length);
    expect(a.filter((l, i) => l !== b[i])).toEqual(["Last line here."]);
    expect(b).toContain("Last word here.");
  });

  it("an edit in the middle leaves the blocks around it alone and uses the file's line ends", () => {
    const plan = planRich(note)!;
    const out = rewrite(plan, plan.base.replace("This paragraph is hard wrapped over three lines.", "Now short."));
    expect(out).toBe(note.replace("This paragraph is\r\nhard wrapped over\r\nthree lines.", "Now short."));
  });

  it("adding and removing blocks keeps everything else", () => {
    const md = "# A\n\nOne.\n\nTwo.\n\nThree.\n";
    const plan = planRich(md)!;
    expect(rewrite(plan, plan.base + "\n\nFour.")).toBe("# A\n\nOne.\n\nTwo.\n\nThree.\n\nFour.\n");
    expect(rewrite(plan, plan.base.replace("\n\nTwo.", ""))).toBe("# A\n\nOne.\n\nThree.\n");
    expect(rewrite(plan, plan.base.replace("One.", "One.\n\nNew."))).toBe("# A\n\nOne.\n\nNew.\n\nTwo.\n\nThree.\n");
    expect(rewrite(plan, "Top.\n\n" + plan.base)).toBe("Top.\n\n# A\n\nOne.\n\nTwo.\n\nThree.\n");
  });

  it("a loose list the rich view tightens still lines up", () => {
    const md = "- a\n\n- b\n\nText.\n";
    const plan = planRich(md)!;
    expect(plan).not.toBeNull();
    expect(rewrite(plan, plan.base)).toBe(md);
    expect(rewrite(plan, plan.base.replace("Text.", "Changed."))).toBe("- a\n\n- b\n\nChanged.\n");
  });
});
