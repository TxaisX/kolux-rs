import { afterEach, describe, expect, it, vi } from "vitest";
import * as markdown from "./markdown";
import { richChange } from "./frontMatter";
import { roundTrip } from "./markdown";

// Row 937 (r12 review): only the invariant was wrapped; a throw anywhere else in richChange escaped to the pane with no write and no banner.
describe("richChange: a throw anywhere in it is a refusal", () => {
  afterEach(() => vi.restoreAllMocks());

  const edit = () => {
    const body = "alpha beta\n\n- one\n- two\n";
    const prev = roundTrip(body)!;
    return { body, prev, out: roundTrip(prev.replace("alpha", "alphas"))! };
  };

  it("a throw in a placement step returns null and calls refused, once", () => {
    const { body, prev, out } = edit();
    const real = markdown.changeBetween;
    // The first call is richChange's own placement step; the throw must not leave the function.
    vi.spyOn(markdown, "changeBetween").mockImplementation(() => {
      throw new Error("boom");
    });
    let refused = 0;
    let got: ReturnType<typeof richChange> | undefined;
    expect(() => (got = richChange(body, out, prev, () => refused++))).not.toThrow();
    expect(got).toBeNull();
    expect(refused).toBe(1);
    vi.restoreAllMocks();
    // Unspied, the same edit saves.
    expect(real).toBe(markdown.changeBetween);
    expect(richChange(body, out, prev)).toMatchObject({ from: 5, to: 5, insert: "s" });
  });

  it("a throw with no refusal callback is still a null, not an exception", () => {
    const { body, prev, out } = edit();
    vi.spyOn(markdown, "changeBetween").mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => richChange(body, out, prev)).not.toThrow();
    expect(richChange(body, out, prev)).toBeNull();
  });
});
