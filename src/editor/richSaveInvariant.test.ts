import { describe, expect, it } from "vitest";
import { richChange } from "./frontMatter";
import { saveBreaksInvariant } from "./richSaveInvariant";

// Row 94 round 11: a save that moved a byte outside the edit, or an untouched list's loose/tight state, marker or gaps, is refused.
describe("saveBreaksInvariant", () => {
  it("fails when a byte outside the edit window changed", () => {
    const body = "one\n\ntwo\n\nthree\n";
    expect(saveBreaksInvariant(body, "one!\n\ntwo\n\nthree X\n", "one\n\ntwo\n\nthree", "one\n\ntwo\n\nthree X")).toMatch(/outside/);
  });

  it("fails when CRLF line ends outside the edit became LF", () => {
    const body = "one\r\n\r\ntwo\r\n\r\nthree\r\n";
    expect(saveBreaksInvariant(body, "one\n\ntwo\r\n\r\nthree X\r\n", "one\n\ntwo\n\nthree", "one\n\ntwo\n\nthree X")).toMatch(/outside/);
    expect(saveBreaksInvariant(body, "one\r\n\r\ntwo\r\n\r\nthree X\r\n", "one\n\ntwo\n\nthree", "one\n\ntwo\n\nthree X")).toBeNull();
  });

  it("fails when an untouched list went from tight to loose", () => {
    const body = "- a\n- b\n- c\n";
    const prev = "- a\n- b\n- c";
    expect(saveBreaksInvariant(body, "- a\n- b\n\n- c d\n", prev, "- a\n- b\n- c d")).toMatch(/loose/);
  });

  it("fails when an untouched list went from loose to tight", () => {
    const body = "- a\n\n- b\n\n- c\n";
    const prev = "- a\n- b\n- c";
    expect(saveBreaksInvariant(body, "- a\n- b\n\n- c d\n", prev, "- a\n- b\n- c d")).not.toBeNull();
  });

  it("fails when an untouched item changed its marker from + to -", () => {
    expect(saveBreaksInvariant("- a\n+ b\n- c\n", "- a2\n- b\n- c\n", "- a\n- b\n- c", "- a2\n- b\n- c")).not.toBeNull();
  });

  it("fails when joining two lists saves the result loose though the view shows it tight (fuzz 63:170)", () => {
    const body = "- itemitem\n\n nested\n\n deeper]\n\n- threeta\n\n3. 3. gamma\n\n4. |delta\n";
    const prev = "- itemitem\n\n nested\n\n deeper]\n\n- threeta\n\n3. 3. gamma\n4. |delta";
    const out = "- itemitem\n\n nested\n\n deeper]\n\n1. - threeta\n2. 3. gamma\n3. |delta";
    expect(saveBreaksInvariant(body, "- itemitem\n\n nested\n\n deeper]\n1. - threeta\n2. 3. gamma\n\n3. |delta\n", prev, out)).not.toBeNull();
  });

  it("passes when the view edit itself changed the marker", () => {
    const body = "- a\n- b\n- c\n";
    expect(saveBreaksInvariant(body, "- a\n* b\n- c\n", "- a\n- b\n- c", "- a\n* b\n- c")).toBeNull();
  });

  it("passes a normal edit inside an item", () => {
    const body = "- a\n- b\n- c\n\nTail\n";
    expect(saveBreaksInvariant(body, "- a\n- bX\n- c\n\nTail\n", "- a\n- b\n- c\n\nTail", "- a\n- bX\n- c\n\nTail")).toBeNull();
  });

  it("richChange refuses a save the invariant rejects and leaves the note alone", () => {
    // Joining n1 onto its parent: keeping the blank line loosens the outer list, dropping it moves an untouched blank.
    const now = "- a\n  * x\n  - n1\n\n  - n2-\n- b\n";
    const prev = "- a\n    - x\n    - n1\n    - n2-\n- b";
    let refused = false;
    const c = richChange(now, "- a n1\n    - n2-\n- b", prev, () => (refused = true));
    expect(refused).toBe(true);
    expect(c).toBeNull();
  });
});
