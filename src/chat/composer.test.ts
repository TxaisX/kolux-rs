import { describe, expect, it } from "vitest";
import { DRAFT_LIMIT, HISTORY_LIMIT, MAX_LINES, draftOf, enqueue, forwardsToBox, harmless, keepDraft, keyAction, linesFor, nearBottom, remember, sendSteps, stepHistory, typeSteps } from "./composer";
import { capPending, combine, sentIn, type ChatItem } from "./model";

describe("message box (CHAT-017, T-327)", () => {
  it("Enter sends, Shift+Enter is a new line, an IME composition never sends", () => {
    expect(keyAction({ key: "Enter" }, true, true)).toBe("send");
    expect(keyAction({ key: "Enter", shiftKey: true }, true, true)).toBe("newline");
    expect(keyAction({ key: "Enter", isComposing: true }, true, true)).toBeNull();
    expect(keyAction({ key: "Process", keyCode: 229 }, true, true)).toBeNull();
    expect(keyAction({ key: "Enter", keyCode: 229 }, true, true)).toBeNull();
    expect(keyAction({ key: "Escape" }, true, true)).toBe("escape");
  });

  it("the arrows step through history only from the first or last line", () => {
    expect(keyAction({ key: "ArrowUp" }, true, false)).toBe("older");
    expect(keyAction({ key: "ArrowUp" }, false, true)).toBeNull();
    expect(keyAction({ key: "ArrowDown" }, false, true)).toBe("newer");
    expect(keyAction({ key: "ArrowDown" }, true, false)).toBeNull();
    const h = ["one", "two"];
    expect(stepHistory(h, 2, "older")).toBe(1);
    expect(stepHistory(h, 0, "older")).toBe(0);
    expect(stepHistory(h, 1, "newer")).toBe(2);
    expect(stepHistory(h, 2, "newer")).toBe(2);
  });

  it("blank sends are not remembered and an exact repeat is stored once, as the newest", () => {
    expect(remember(["a"], "   ")).toEqual(["a"]);
    expect(remember(["a", "b"], "a")).toEqual(["b", "a"]);
    expect(remember(["a"], "a ")).toEqual(["a", "a "]);
    const full = Array.from({ length: HISTORY_LIMIT }, (_, i) => `m${i}`);
    expect(remember(full, "new")).toHaveLength(HISTORY_LIMIT);
    expect(remember(full, "new")[HISTORY_LIMIT - 1]).toBe("new");
  });

  it("12 lines stop the box at 8; one line is one", () => {
    expect(linesFor(Array(12).fill("x").join("\n"))).toBe(MAX_LINES);
    expect(linesFor("")).toBe(1);
    expect(linesFor("a\nb\nc")).toBe(3);
  });

  it("a draft is kept per pane, cleared by an empty box, and not kept past the limit", () => {
    keepDraft(7, "half a thought");
    keepDraft(8, "other pane");
    expect(draftOf(7)).toBe("half a thought");
    expect(draftOf(8)).toBe("other pane");
    keepDraft(7, "");
    expect(draftOf(7)).toBe("");
    keepDraft(9, "x".repeat(DRAFT_LIMIT + 1));
    expect(draftOf(9)).toBe("");
  });

  it("printable keys and Backspace elsewhere in the pane go to the box; shortcuts do not", () => {
    expect(forwardsToBox({ key: "a" })).toBe(true);
    expect(forwardsToBox({ key: "é" })).toBe(true);
    expect(forwardsToBox({ key: "Backspace" })).toBe(true);
    expect(forwardsToBox({ key: "Delete" })).toBe(true);
    expect(forwardsToBox({ key: "c", ctrlKey: true })).toBe(false);
    expect(forwardsToBox({ key: "ArrowUp" })).toBe(false);
    expect(forwardsToBox({ key: "Tab" })).toBe(false);
  });
});

describe("sending into the terminal (CHAT-020, T-327)", () => {
  it("one line: clear the input line, type it, Enter after a pause", () => {
    const s = sendSteps("claude", "fix the test");
    expect(s.map((x) => x.data)).toEqual(["\x15", "fix the test", "\r"]);
    expect(s[1].waitMs).toBeGreaterThanOrEqual(200);
  });

  it("several lines arrive whole as one bracketed paste", () => {
    const s = sendSteps("claude", "line one\nline two\r\nline three");
    expect(s[1].data).toBe("\x1b[200~line one\rline two\rline three\x1b[201~");
    expect(s).toHaveLength(3);
  });

  it("escape and control characters are made harmless, so a message cannot end the paste early", () => {
    expect(harmless("a\x1b[201~b\x07c\td")).toBe("a[201~bc\td");
    expect(sendSteps("claude", "x\x1b[201~\x03\ny")[1].data).toBe("\x1b[200~x[201~\ry\x1b[201~");
    expect(sendSteps("claude", " \n\x1b ")).toEqual([]);
  });

  it("a Codex picker command is typed key by key; other slash commands are pasted", () => {
    const picker = sendSteps("codex", "/model");
    expect(picker.map((x) => x.data)).toEqual(["\x15", "/", "m", "o", "d", "e", "l", "\r"]);
    expect(sendSteps("codex", "/compact now").map((x) => x.data)).toEqual(["\x15", "/compact now", "\r"]);
    expect(sendSteps("claude", "/model").map((x) => x.data)).toEqual(["\x15", "/model", "\r"]);
  });

  it("two sends within 100 ms reach one terminal whole and in order", async () => {
    const got: string[] = [];
    const write = async (d: string) => {
      await new Promise((r) => setTimeout(r, Math.random() * 5));
      got.push(d);
    };
    const fast = () => Promise.resolve();
    const a = enqueue(41, () => typeSteps(sendSteps("claude", "first"), write, fast));
    const b = enqueue(41, () => typeSteps(sendSteps("claude", "second"), write, fast));
    await Promise.all([a, b]);
    expect(got).toEqual(["\x15", "first", "\r", "\x15", "second", "\r"]);
  });

  it("a failed send rejects, and the next send to that terminal still runs", async () => {
    const bad = enqueue(42, () => Promise.reject(new Error("pty gone")));
    await expect(bad).rejects.toThrow("pty gone");
    await expect(enqueue(42, async () => "ok")).resolves.toBe("ok");
  });

  it("pending bubbles: confirmed by the recorded turn, also when two sends merged; at most 8; a failure shows", () => {
    expect(sentIn("first\nsecond", "second")).toBe(true);
    expect(sentIn("first\nsecond", "first")).toBe(true);
    expect(sentIn("first  second", "first second")).toBe(true);
    expect(sentIn("go to the second floor", "second")).toBe(false);
    const turn: ChatItem = { id: "u", role: "user", kind: "text", text: "first\nsecond", at: 1_000 };
    const rows = combine([turn], [], null, [
      { id: "p1", text: "first", at: 900 },
      { id: "p2", text: "second", at: 950 },
      { id: "p3", text: "third", at: 960, failed: true },
    ]);
    expect(rows.filter((r) => r.row === "pending").map((r) => [r.id, r.row === "pending" && r.failed])).toEqual([["p3", true]]);
    expect(capPending(Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, text: `${i}`, at: i })))).toHaveLength(8);
  });
});

describe("sticking to the newest message (CHAT-027, T-327)", () => {
  it("within 48 px of the bottom follows; 500 px up holds still", () => {
    expect(nearBottom({ scrollHeight: 2000, clientHeight: 500, scrollTop: 1500 })).toBe(true);
    expect(nearBottom({ scrollHeight: 2000, clientHeight: 500, scrollTop: 1452 })).toBe(true);
    expect(nearBottom({ scrollHeight: 2000, clientHeight: 500, scrollTop: 1451 })).toBe(false);
    expect(nearBottom({ scrollHeight: 2000, clientHeight: 500, scrollTop: 1000 })).toBe(false);
  });
});
