// T-325-c: the turn reader against fake buffers (no xterm loaded).
import { afterEach, describe, expect, it, vi } from "vitest";
import { blocks, logicalLines, readPane, readTurn, registerTurnSource, replyOf, trimChrome, turnStart, watchTurn, type ReadBuf, type TurnSource } from "./turnRead";

/** Rows as written; a row given as ["text", true] continues the row above (wrapped). */
type Row = string | [string, true];
function fake(rows: Row[], opts: { cursorY?: number; baseY?: number; type?: "normal" | "alternate" } = {}): ReadBuf {
  const lines = rows.map((r) => (typeof r === "string" ? { text: r, wrapped: false } : { text: r[0], wrapped: true }));
  const baseY = opts.baseY ?? 0;
  return {
    type: opts.type ?? "normal",
    get length() {
      return lines.length;
    },
    baseY,
    viewportY: baseY,
    cursorY: opts.cursorY ?? lines.length - 1 - baseY,
    getLine: (y) => (lines[y] ? { isWrapped: lines[y].wrapped, translateToString: (trim?: boolean) => (trim ? lines[y].text.replace(/\s+$/, "") : lines[y].text) } : undefined),
  };
}

// A Claude-style screen while a reply streams: echo, reply, spinner, input box, footer.
const CLAUDE: Row[] = [
  "old output from before",
  "> explain the build",
  "",
  "⏺ The build runs in three steps. First cargo compiles the ",
  ["back end, then the front end is bundled.", true],
  "  Last, the installer is made.",
  "",
  "✻ Thinking… (12s · esc to interrupt)",
  "",
  "╭──────────────────────────────╮",
  "│ >                            │",
  "╰──────────────────────────────╯",
  "  ? for shortcuts",
];

describe("logicalLines", () => {
  it("joins wrapped rows onto the row they continue", () => {
    const b = fake(["one", "two ", ["three", true], "four"]);
    expect(logicalLines(b, 0, 3)).toEqual(["one", "two three", "four"]);
  });
  it("a start inside a wrapped line begins at that line's first row", () => {
    const b = fake(["head ", ["tail", true], "next"]);
    expect(logicalLines(b, 1, 2)).toEqual(["head tail", "next"]);
  });
});

describe("turnStart", () => {
  it("starts after the nearest prompt echo at or above the marker", () => {
    expect(turnStart(fake(CLAUDE), 6)).toBe(2);
  });
  it("skips a prompt row right under a box rule (the input box)", () => {
    const b = fake(["> first ask", "reply", "────────", "> typed", "────────"]);
    expect(turnStart(b, 4)).toBe(1);
  });
  it("keeps the marker when no echo is found", () => {
    expect(turnStart(fake(["a", "b", "c"]), 2)).toBe(2);
  });
});

describe("trimChrome", () => {
  it("drops the input box, footer, spinner and edge blanks", () => {
    expect(trimChrome(["", "reply", "", "✻ Thinking… (esc to interrupt)", "────", "> hi", "────", "? for shortcuts"])).toEqual(["reply"]);
  });
  it("keeps blank rows inside the reply and drops framed rows anywhere", () => {
    expect(trimChrome(["a", "", "│ Do you want to proceed? │", "b"])).toEqual(["a", "", "b"]);
  });
  it("a markdown rule made of hyphens is not a box rule", () => {
    expect(trimChrome(["a", "---"])).toEqual(["a", "---"]);
  });
});

describe("blocks and replyOf", () => {
  it("a bullet naming a tool call and its ⎿ rows are tool output", () => {
    const bs = blocks(["⏺ Bash(cargo test)", "  ⎿  ok 12 passed", "", "⏺ All tests pass."]);
    expect(bs.map((b) => b.tool)).toEqual([true, false]);
    expect(replyOf(["⏺ Bash(cargo test)", "  ⎿  ok 12 passed", "", "⏺ All tests pass."])).toEqual({ text: "All tests pass." });
  });
  it("only tool output is marked tool and carries no text", () => {
    expect(replyOf(["⏺ Read(src/main.rs)", "  ⎿  Read 40 lines"])).toEqual({ text: "", tool: true });
    expect(replyOf(["• Ran cargo build", "  └ Finished dev"])).toEqual({ text: "", tool: true });
  });
  it("a reply bullet whose words hold brackets stays reply text", () => {
    expect(replyOf(["⏺ I'll fix this (quickly) now."])).toEqual({ text: "I'll fix this (quickly) now." });
    expect(replyOf(["• Read the docs first."])).toEqual({ text: "Read the docs first." });
  });
  it("a ⎿ row under a reply bullet splits off as its own tool block", () => {
    expect(replyOf(["⏺ Checking.", "  ⎿  tool said", "     more"]).text).toBe("Checking.");
  });
  it("text with no bullets (a plain agent) is the reply", () => {
    expect(replyOf(["Hello", "world"])).toEqual({ text: "Hello\nworld" });
  });
  it("nothing at all is blank, not tool", () => {
    expect(replyOf(["", "────"])).toEqual({ text: "", tool: false });
  });
});

describe("readTurn", () => {
  it("reads the reply from the echo to the cursor, wrapped lines joined, chrome trimmed", () => {
    const b = fake(CLAUDE, { cursorY: 10 });
    expect(readTurn(b, 5)).toEqual({ text: "The build runs in three steps. First cargo compiles the back end, then the front end is bundled.\nLast, the installer is made." });
  });
  it("leaves out the previous turn above the echo", () => {
    expect(readTurn(fake(CLAUDE, { cursorY: 10 }), 3).text).not.toContain("old output");
  });
  it("a trimmed marker reads from the screen's top", () => {
    const b = fake(["scrolled away", "⏺ visible reply", "────", "> "], { baseY: 1, cursorY: 2 });
    expect(readTurn(b, -1)).toEqual({ text: "visible reply" });
  });
  it("the alternate screen is read whole", () => {
    const b = fake(["⏺ full-screen reply", "", "› ", "  ctrl+c to quit"], { type: "alternate", cursorY: 2 });
    expect(readTurn(b, 0)).toEqual({ text: "full-screen reply" });
  });
  it("a turn that is only a running tool is marked tool", () => {
    const b = fake(["> run the tests", "⏺ Bash(pnpm test)", "  ⎿  Running…", "✻ Running… (esc to interrupt)", "────", "> "]);
    expect(readTurn(b, 1)).toEqual({ text: "", tool: true });
  });
});

describe("registry, poll and subscribe", () => {
  const offs: (() => void)[] = [];
  afterEach(() => {
    offs.splice(0).forEach((o) => o());
    vi.useRealTimers();
  });

  function liveSource(rows: Row[]) {
    let buf = fake(rows);
    const writes = new Set<() => void>();
    const src: TurnSource = { buffer: () => buf, mark: () => ({ line: 0, dispose: () => {} }), onWrite: (cb) => (writes.add(cb), () => writes.delete(cb)) };
    return {
      src,
      write(next: Row[]) {
        buf = fake(next);
        writes.forEach((w) => w());
      },
      writers: () => writes.size,
    };
  }

  it("readPane is null without a terminal and reads one once registered", () => {
    expect(readPane(901, 0)).toBeNull();
    const s = liveSource(["⏺ hi"]);
    offs.push(registerTurnSource(901, s.src));
    expect(readPane(901, 0)).toEqual({ text: "hi" });
  });

  it("watchTurn reads at once, then at most once per interval while output arrives, only on change", () => {
    vi.useFakeTimers();
    const s = liveSource(["⏺ He"]);
    offs.push(registerTurnSource(902, s.src));
    const seen: string[] = [];
    offs.push(watchTurn(902, (p) => seen.push(p.text), 100));
    expect(seen).toEqual(["He"]);
    s.write(["⏺ Hel"]);
    s.write(["⏺ Hello"]);
    expect(seen).toEqual(["He"]);
    vi.advanceTimersByTime(100);
    expect(seen).toEqual(["He", "Hello"]);
    s.write(["⏺ Hello"]);
    vi.advanceTimersByTime(100);
    expect(seen).toEqual(["He", "Hello"]);
  });

  it("a pane that mounts after the watch starts is picked up; stopping unhooks the writer", () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const stop = watchTurn(903, (p) => seen.push(p.text), 50);
    expect(seen).toEqual([]);
    const s = liveSource(["⏺ late"]);
    const off = registerTurnSource(903, s.src);
    expect(seen).toEqual(["late"]);
    expect(s.writers()).toBe(1);
    stop();
    expect(s.writers()).toBe(0);
    off();
  });
});
