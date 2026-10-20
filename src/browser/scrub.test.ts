import { describe, expect, it } from "vitest";
import { notesMarkdown, readPicks } from "./annotate";
import { cleanUrl, MASK, maskSecrets, scrubPick, STYLE_PROPS } from "./scrub";

describe("BROW-036 grabbed page details are scrubbed of secrets", () => {
  it("masks a token in an input's attributes and strips the key from a link's query", () => {
    const p = scrubPick({
      selector: "#api",
      tag: "input",
      hints: {
        placeholder: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
        "aria-label": "Key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx",
        href: "https://api.example.com/v1/data?key=AKIAABCDEFGHIJKLMNOP&x=1#tok",
        value: "super-secret-value",
        onclick: "steal()",
        "data-secret": "x",
      },
      url: "https://app.example.com/settings?token=abc#frag",
    });
    expect(p).not.toBeNull();
    expect(p!.hints!.placeholder).toBe(MASK);
    expect(p!.hints!["aria-label"]).toBe(`Key ${MASK}`);
    expect(p!.hints!.href).toBe("https://api.example.com/v1/data");
    expect(p!.hints).not.toHaveProperty("value");
    expect(p!.hints).not.toHaveProperty("onclick");
    expect(p!.hints).not.toHaveProperty("data-secret");
    expect(p!.url).toBe("https://app.example.com/settings");
  });

  it("never masks a paragraph of plain prose, long words and hyphenated names included", () => {
    const prose =
      "The quick brown fox jumps over the lazy dog. Internationalization and counterrevolutionaries discuss " +
      "the well-known state-of-the-art implementation-defined behaviour of version 2 in 2026, page 42.";
    expect(maskSecrets(prose)).toBe(prose);
    const p = scrubPick({ selector: "p.intro", text: prose });
    expect(p!.text).toBe(prose);
    // a long lowercase identifier (a CSS class run) is not a secret either
    expect(maskSecrets("btn-primary-large-rounded-outline-hover-state")).toBe("btn-primary-large-rounded-outline-hover-state");
  });

  it("masks the known secret shapes precisely", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    for (const s of [jwt, "xoxb-1234567890-abcdefghij", "AIzaSyA1234567890abcdefghijklmnopqrstuv", "Bearer abcdef0123456789ABCDEF", "a".repeat(10) + "Z9" + "b".repeat(30)]) {
      expect(maskSecrets(`x ${s} y`)).toBe(`x ${MASK} y`);
    }
    expect(maskSecrets("commit 0123456789abcdef0123456789abcdef01234567")).toBe(`commit ${MASK}`);
  });

  it("removes unsafe link schemes and keeps safe ones without their query", () => {
    expect(cleanUrl("javascript:alert(1)")).toBeNull();
    expect(cleanUrl("JaVaScRiPt:alert(1)")).toBeNull();
    expect(cleanUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(cleanUrl("file:///C:/secret.txt")).toBeNull();
    expect(cleanUrl("vbscript:x")).toBeNull();
    expect(cleanUrl("/relative/path?q=1")).toBe("/relative/path");
    expect(cleanUrl("mailto:a@b.test?subject=hi")).toBe("mailto:a@b.test");
    const p = scrubPick({ selector: "a", hints: { href: "javascript:void(0)" } });
    expect(p!.hints).toEqual({});
  });

  it("keeps the fixed 16 style properties only", () => {
    expect(STYLE_PROPS).toHaveLength(16);
    const styles: Record<string, string> = Object.fromEntries(STYLE_PROPS.map((k) => [k, "1"]));
    styles["background-image"] = "url(https://x.test/?token=1)";
    styles["--private-var"] = "secret";
    const p = scrubPick({ selector: "div", styles });
    expect(Object.keys(p!.styles!)).toEqual([...STYLE_PROPS]);
  });

  it("throws away captures with a broken structure", () => {
    expect(scrubPick(null)).toBeNull();
    expect(scrubPick("div")).toBeNull();
    expect(scrubPick({})).toBeNull();
    expect(scrubPick({ selector: "  " })).toBeNull();
    expect(scrubPick({ selector: "div", hints: ["a"] })).toBeNull();
    expect(scrubPick({ selector: "div", hints: { a: 1 } })).toBeNull();
    expect(scrubPick({ selector: "div", styles: "color: red" })).toBeNull();
    expect(scrubPick({ selector: "div", box: { x: 1, y: 2, width: "3", height: 4 } })).toBeNull();
    expect(scrubPick({ selector: "div", box: { x: 1, y: 2, width: NaN, height: 4 } })).toBeNull();
    expect(scrubPick({ selector: "div", text: 5 })).toBeNull();
    expect(scrubPick({ selector: "div", box: { x: 1, y: 2, width: 3, height: 4 } })!.box).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it("is applied to every pick the picker hands over and to the message's address", () => {
    const r = readPicks({ active: true, picks: [{ selector: "#a", hints: { title: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" } }, { selector: 7 }, { escape: true }] });
    expect(r.picks).toHaveLength(1);
    expect(r.picks[0].hints!.title).toBe(MASK);
    expect(r.escape).toBe(true);
    const md = notesMarkdown([{ pick: r.picks[0], text: "fix" }], "Settings", "https://app.test/s?session=abc")!;
    expect(md).toContain("(https://app.test/s)");
    expect(md).not.toContain("session=abc");
  });
});
