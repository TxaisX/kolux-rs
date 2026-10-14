import { beforeEach, describe, expect, it } from "vitest";
import { BLOCKED_NOTICE, decideOsc52, parseOsc52, PAYLOAD_CAP, resetNotices, sayOnce } from "./osc52";

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

describe("TERM-075 programs can copy to the clipboard (OSC 52)", () => {
  beforeEach(resetNotices);

  it("decodes a base64 write (UTF-8, unpadded too) and puts it on the clipboard when allowed", () => {
    expect(parseOsc52(`c;${b64("yanked line ✓")}`)).toEqual({ kind: "write", text: "yanked line ✓" });
    expect(parseOsc52(`c;${b64("ab").replace(/=+$/, "")}`)).toEqual({ kind: "write", text: "ab" });
    expect(decideOsc52(parseOsc52(`c;${b64("hello")}`), true)).toEqual({ write: "hello" });
  });

  it("answers a read-back query with nothing, whatever the setting", () => {
    expect(parseOsc52("c;?")).toEqual({ kind: "query" });
    for (const allowed of [true, false]) {
      const d = decideOsc52({ kind: "query" }, allowed);
      expect(d.write).toBeUndefined();
      expect(d.reply).toBe("\x1b]52;c;\x1b\\");
    }
  });

  it("blocks the write when the setting is off and says so once per session", () => {
    const d = decideOsc52(parseOsc52(`c;${b64("secret")}`), false);
    expect(d.write).toBeUndefined();
    expect(d.notice?.text).toBe(BLOCKED_NOTICE);
    const shown: string[] = [];
    expect(sayOnce(d.notice!.key, d.notice!.text, (t) => shown.push(t))).toBe(true);
    expect(sayOnce(d.notice!.key, d.notice!.text, (t) => shown.push(t))).toBe(false);
    expect(shown).toHaveLength(1);
  });

  it("caps the payload and clears on a non-base64 payload", () => {
    const big = "A".repeat(PAYLOAD_CAP + 1);
    expect(parseOsc52(`c;${big}`)).toEqual({ kind: "over", size: PAYLOAD_CAP + 1 });
    expect(decideOsc52({ kind: "over", size: PAYLOAD_CAP + 1 }, true).notice?.key).toBe("osc52-over");
    expect(parseOsc52("c;!")).toEqual({ kind: "clear" });
    expect(parseOsc52("c;")).toEqual({ kind: "clear" });
    expect(decideOsc52({ kind: "clear" }, true)).toEqual({ write: "" });
    expect(decideOsc52({ kind: "clear" }, false)).toEqual({});
  });

  it("never shows the over-cap notice while the setting is off", () => {
    const d = decideOsc52({ kind: "over", size: PAYLOAD_CAP + 1 }, false);
    expect(d.notice?.key).toBe("osc52-blocked");
    expect(d.write).toBeUndefined();
  });

  it("a hidden pane never writes the clipboard or says anything, but still answers a query", () => {
    for (const allowed of [true, false]) {
      expect(decideOsc52(parseOsc52(`c;${b64("hi")}`), allowed, false)).toEqual({});
      expect(decideOsc52({ kind: "clear" }, allowed, false)).toEqual({});
      expect(decideOsc52({ kind: "over", size: PAYLOAD_CAP + 1 }, allowed, false)).toEqual({});
      expect(decideOsc52({ kind: "query" }, allowed, false).reply).toBe("]52;c;\\");
    }
  });
});
