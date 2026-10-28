import { afterEach, describe, expect, it, vi } from "vitest";
import * as markdown from "./markdown";
import { placeStats, richChange } from "./frontMatter";
import { roundTrip } from "./markdown";

// Row 937 (r12 review): only the invariant was wrapped; a throw anywhere else in richChange escaped to the pane with no write and no banner.
describe("richChange: a throw anywhere in it is a refusal", () => {
  afterEach(() => vi.restoreAllMocks());

  const edit = () => {
    const body = "alpha beta\n\n- one\n- two\n";
    const prev = roundTrip(body)!;
    return { body, prev, out: roundTrip(prev.replace("alpha", "alphas"))! };
  };
  const throwing = () =>
    vi.spyOn(markdown, "changeBetween").mockImplementation(() => {
      throw new Error("boom");
    });

  it("a throw in a placement step returns null and calls refused, once", () => {
    const { body, prev, out } = edit();
    // The first call is richChange's own placement step; the throw must not leave the function.
    throwing();
    vi.spyOn(console, "error").mockImplementation(() => {});
    let refused = 0;
    let got: ReturnType<typeof richChange> | undefined;
    expect(() => (got = richChange(body, out, prev, () => refused++))).not.toThrow();
    expect(got).toBeNull();
    expect(refused).toBe(1);
    vi.restoreAllMocks();
    // Restored, and the same edit saves.
    expect(vi.isMockFunction(markdown.changeBetween)).toBe(false);
    expect(richChange(body, out, prev)).toMatchObject({ from: 5, to: 5, insert: "s" });
  });

  it("a throw with no refusal callback is still a null, not an exception", () => {
    const { body, prev, out } = edit();
    throwing();
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => richChange(body, out, prev)).not.toThrow();
    expect(richChange(body, out, prev)).toBeNull();
  });

  // Row 981: a throw is a bug, not an ordinary refusal; it is logged and counted apart so the fuzz can assert there are none.
  it("a throw is logged with a tag and counted in placeStats.threw, apart from ordinary refusals", () => {
    const { body, prev, out } = edit();
    throwing();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = { threw: placeStats.threw, refused: placeStats.refused };
    let refused = 0;
    expect(richChange(body, out, prev, () => refused++)).toBeNull();
    expect(refused).toBe(1);
    expect(placeStats.threw).toBe(before.threw + 1);
    expect(placeStats.refused).toBe(before.refused + 1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("richChange");
  });

  it("an ordinary refusal does not count as a throw", () => {
    const body = "alpha beta\n\n- one\n- two\n";
    const threw = placeStats.threw;
    let refused = 0;
    // A prev that is not the body's view text cannot be placed: a plain refusal.
    richChange(body, "completely different\n", "unrelated text\n", () => refused++);
    expect(placeStats.threw).toBe(threw);
  });
});
