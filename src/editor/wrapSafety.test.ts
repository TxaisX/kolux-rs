import { describe, expect, it } from "vitest";
import { hideFrontFor, richChange } from "./frontMatter";
import { roundTrip, unsupported } from "./markdown";

// Row 94 review (EDIT-019): opening and saving a note never changes bytes the user did not edit.
const apply = (t: string, c: { from: number; to: number; insert: string }) => t.slice(0, c.from) + c.insert + t.slice(c.to);

describe("a big hard-wrapped note (review HIGH)", () => {
  const paras = Array.from({ length: 800 }, (_, i) => `para ${i} first_line of some snake_case words\nsecond line with *star* here\nthird line wraps on\nfourth line ends the paragraph`);
  const body = paras.join("\n\n") + "\n";
  const prev = roundTrip(body)!;
  it.each([0, 280, 799])("one character edited in paragraph %i leaves every other wrap and byte as the file had it, fast", (n) => {
    expect(body.length).toBeGreaterThan(100_000);
    const mark = `para ${n} first_line`;
    const at = body.indexOf(mark);
    const edited = body.slice(0, at) + `para ${n} firsT_line` + body.slice(at + mark.length);
    const out = roundTrip(edited)!;
    const t0 = performance.now();
    const c = richChange(body, out, prev)!;
    const ms = performance.now() - t0;
    expect(apply(body, c)).toBe(edited);
    expect(ms).toBeLessThan(250);
  });
});

describe("code the rich view would flow into one line (review MEDIUM)", () => {
  it("a ~~~ fence is not merged (the note stays in source view)", () => {
    const md = "~~~\nconst a = 1\nconst b = 2\n~~~";
    expect(roundTrip(md)).not.toContain("const a = 1 const b = 2");
    expect(unsupported(md)).not.toBeNull();
  });
  it("an indented code block is not merged (the note stays in source view)", () => {
    const md = "intro\n\n    line one\n    line two";
    expect(roundTrip(md)).not.toContain("line one line two");
    expect(unsupported(md)).not.toBeNull();
  });
  it("a nested paragraph under a list item is not indented code", () => {
    expect(unsupported("- item\n\n    more of the item\n    and more\n")).toBeNull();
  });
});

describe("the HTML guard (review MEDIUM-LOW)", () => {
  it("a tag repeated inside a code fence does not hide a prose tag the rich view would rewrite", () => {
    const tag = '<a href="https://x.y/a_b_c">q</a>';
    expect(unsupported(`${tag}\n\n\`\`\`html\n${tag}\n\`\`\`\n`)).toBe("it has HTML");
  });
});

describe("a line that starts a list item (review LOW)", () => {
  it("2) after 1. is a new item, not part of the first", () => {
    const back = roundTrip("1. a\n2) b")!;
    expect(back).not.toContain("a 2)");
    expect(back).toMatch(/^2\) b$/m);
  });
});

describe("front matter choice per file (review LOW)", () => {
  it("is read for the file shown, not carried from the file shown before", () => {
    const read = (p: string) => p === "b.md";
    expect(hideFrontFor({ path: "a.md", hide: false }, "b.md", read)).toBe(true);
    expect(hideFrontFor({ path: "b.md", hide: false }, "b.md", read)).toBe(false);
  });
});
