import { describe, expect, it } from "vitest";
import { richChange } from "./frontMatter";

function save(now: string, prev: string, out: string): string | null {
  const c = richChange(now, out, prev);
  return c && now.slice(0, c.from) + c.insert + now.slice(c.to);
}

// Row 926: the file's blank line at the edit's boundary is kept (the invariant still arbitrates), so these saves are no longer refused.
describe("richChange keeps the boundary gap", () => {
  it("keeps the gap above the nested item left behind when two items merge (fuzz 189:6)", () => {
    expect(save("-\n\n- a 0\n  - n1\nlazy\n\n  - n2\n- b.s - today\n", "-\n\n- a 0\n    - n1 lazy\n    - n2\n- b.s - today", "-\n\n- a 0 n1 lazy\n    - n2\n- b.s - today")).toBe(
      "-\n\n- a 0 n1\nlazy\n\n  - n2\n- b.s - today\n",
    );
  });

  it("keeps the gap when a joined first item has a different marker (fuzz 1626)", () => {
    expect(save("> quote- n2.\n- b\n\n\n- a 2\n  * x\n  - n1\n\n  - n2\n- b.", "> quote- n2.\n\n- b\n- a 2\n    - x\n    - n1\n    - n2\n- b.", "> quote- n2.\n\n- b\n- a 2\n    - xn1\n    - n2\n- b.")).toBe(
      "> quote- n2.\n- b\n\n\n- a 2\n  * xn1\n\n  - n2\n- b.",
    );
  });

  it("keeps the gap in a note that starts with prose and a loose list (fuzz 3716)", () => {
    expect(save("Ends`npm t` tests\n\n- done\n\n- 2\n  * x\n  - n1\n\n  - n2\n- b\n", "Ends`npm t` tests\n\n- done\n- 2\n    - x\n    - n1\n    - n2\n- b", "Ends`npm t` tests\n\n- done\n- 2\n    - xn1\n    - n2\n- b")).toBe(
      "Ends`npm t` tests\n\n- done\n\n- 2\n  * xn1\n\n  - n2\n- b\n",
    );
  });

  it("keeps the gap when a later loose item follows the merge (fuzz 1825)", () => {
    expect(save("- a 0\n  - n1\nlazy\n\n  - n2\n- b\n\n- a 1\n\n  indented para\n- b", "- a 0\n    - n1 lazy\n    - n2\n- b\n- a 1\n\n  indented para\n\n- b", "- a 0 -- n1 lazy\n    - n2\n- b\n- a 1\n\n  indented para\n\n- b")).toBe(
      "- a 0 -- n1\nlazy\n\n  - n2\n- b\n\n- a 1\n\n  indented para\n- b",
    );
  });
});

// Guard twins: here keeping the gap would loosen the tight parent item, so the save is refused, never written loose.
describe("richChange does not keep a gap that loosens a parent list", () => {
  it("refuses the tight twin of 189:6", () => {
    expect(save("- a 0\n  - n1\nlazy\n\n  - n2\n- b.s - today\n", "- a 0\n    - n1 lazy\n    - n2\n- b.s - today", "- a 0 n1 lazy\n    - n2\n- b.s - today")).toBeNull();
  });

  it("refuses a tight parent whose first nested item merged into its text", () => {
    expect(save("- a 0\n  - n1\n\n  - n2\n- b\n", "- a 0\n    - n1\n    - n2\n- b", "- a 0 n1\n    - n2\n- b")).toBeNull();
  });

  it("refuses the tight twin of 1626", () => {
    expect(save("- a 2\n  * x\n  - n1\n\n  - n2\n- b.\n", "- a 2\n    - x\n    - n1\n    - n2\n- b.", "- a 2\n    - xn1\n    - n2\n- b.")).toBeNull();
  });
});
