// Council FIX-2 (re-review of chat 8151d6f): the Enter waits out a tool's start, readings from an
// earlier run do not count, a card answer clears the chat's own reading, and the window's own
// pastes (Send notes, a kit's role prompt) go through the same check as the chat box.
import { afterEach, describe, expect, it } from "vitest";
import { LIMIT } from "../terminal/paste";
import { ASKING_NOTE } from "./composer";
import { TOOL_HOLD_MS, UNSEEN_NOTE, answered, forgetHearing, hearStates, holdFor, pasteToPane, sendToPane, setClock } from "./send";

type Status = { paneKey: number; state?: string; tool?: string; terminal?: number };
type Handler = (e: { payload: Status }) => void;

function fakeListen() {
  const handlers: Handler[] = [];
  const listen = (_name: string, h: Handler) => {
    handlers.push(h);
    return Promise.resolve(() => {});
  };
  return { listen, emit: (p: Status) => handlers.forEach((h) => h({ payload: p })) };
}

/** A clock the sends' pauses move forward, so a one-second hold takes no real time. `at(ms, f)` runs
 * `f` once the clock passes `ms` (a hook event arriving during a pause). */
function fakeTime() {
  let now = 0;
  const due: { ms: number; f: () => void }[] = [];
  setClock(() => now);
  const sleep = async (ms: number) => {
    now += ms;
    for (const d of due.filter((x) => x.ms <= now)) {
      due.splice(due.indexOf(d), 1);
      d.f();
    }
  };
  return { sleep, now: () => now, at: (ms: number, f: () => void) => due.push({ ms, f }) };
}

function writes() {
  const got: { id: number; data: string; at: number }[] = [];
  return { got, write: (clock: () => number) => async (id: number, data: string) => void got.push({ id, data, at: clock() }) };
}

afterEach(() => forgetHearing());

describe("the Enter waits about a second after a tool starts (council FS1: working counts as clear)", () => {
  it("a menu that opens in that second stops the send before its Enter", async () => {
    const { listen, emit } = fakeListen();
    await hearStates(listen);
    const t = fakeTime();
    emit({ paneKey: 7, state: "working", tool: "Bash", terminal: 70 });
    t.at(500, () => emit({ paneKey: 7, state: "permission", tool: "Bash", terminal: 70 }));
    const w = writes();
    const got = await sendToPane(7, "claude", "keep going", { terminalOf: () => 70, write: w.write(t.now), sleep: t.sleep });
    expect(got).toBe("stopped");
    expect(w.got.map((x) => x.data)).not.toContain("\r");
  });

  it("with nothing after the tool start, the Enter goes once the second is up, not before", async () => {
    const { listen, emit } = fakeListen();
    await hearStates(listen);
    const t = fakeTime();
    emit({ paneKey: 7, state: "working", tool: "Read", terminal: 70 });
    const w = writes();
    expect(await sendToPane(7, "claude", "keep going", { terminalOf: () => 70, write: w.write(t.now), sleep: t.sleep })).toBe("sent");
    const enter = w.got.find((x) => x.data === "\r");
    expect(enter?.at).toBeGreaterThanOrEqual(TOOL_HOLD_MS);
    expect(TOOL_HOLD_MS).toBe(1000);
  });

  it("a tool that already finished (PostToolUse: working with no tool) holds nothing", async () => {
    const { listen, emit } = fakeListen();
    await hearStates(listen);
    const t = fakeTime();
    emit({ paneKey: 7, state: "working", tool: "Read", terminal: 70 });
    emit({ paneKey: 7, state: "working", terminal: 70 });
    const w = writes();
    expect(await sendToPane(7, "claude", "next", { terminalOf: () => 70, write: w.write(t.now), sleep: t.sleep })).toBe("sent");
    expect(w.got.find((x) => x.data === "\r")?.at).toBeLessThan(TOOL_HOLD_MS);
  });

  it("the wait is said in the box while it lasts", async () => {
    const { listen, emit } = fakeListen();
    await hearStates(listen);
    const t = fakeTime();
    emit({ paneKey: 7, state: "working", tool: "Read", terminal: 70 });
    const said: string[] = [];
    const w = writes();
    await sendToPane(7, "claude", "next", { terminalOf: () => 70, write: w.write(t.now), sleep: t.sleep, onWait: (n) => said.push(n) });
    expect(said.length).toBeGreaterThan(0);
    expect(said[0]).toMatch(/starting a tool/);
  });
});

describe("the paste limit counts bytes (council AFTER 1)", () => {
  it("a message under the limit in characters but over it in UTF-8 bytes is not sent", async () => {
    const w = writes();
    const text = "€".repeat(LIMIT / 2);
    expect(text.length).toBeLessThan(LIMIT);
    expect(await sendToPane(7, "claude", text, { terminalOf: () => 70, stateOf: () => "idle", write: w.write(() => 0), sleep: async () => {} })).toBe("too-long");
    expect(w.got).toEqual([]);
  });
});

describe("readings do not outlive a restart (council FS4)", () => {
  it("a reading heard from the pane's earlier terminal does not let a send into its new one", async () => {
    const { listen, emit } = fakeListen();
    await hearStates(listen);
    emit({ paneKey: 7, state: "done", terminal: 70 });
    // The program was started again in a new terminal (71); no hook has fired there yet, and the
    // window still holds the old "done".
    const w = writes();
    const got = await sendToPane(7, "claude", "1", { terminalOf: () => 71, stateOf: () => "done", write: w.write(() => 0), sleep: async () => {} });
    expect(got).toBe("held");
    expect(w.got).toEqual([]);
    expect(holdFor(7, () => "done", 71)).toBe(UNSEEN_NOTE);
    expect(holdFor(7, () => "done", 70)).toBeUndefined();
  });
});

describe("a card answer clears the chat's own reading (council FS3)", () => {
  it("after Approve or Deny on a card the chat no longer holds on the old permission", async () => {
    const { listen, emit } = fakeListen();
    await hearStates(listen);
    emit({ paneKey: 7, state: "permission", tool: "Bash", terminal: 70 });
    expect(holdFor(7, () => "working", 70)).toBe(ASKING_NOTE);
    answered(7);
    expect(holdFor(7, () => "working", 70)).toBeUndefined();
  });
});

describe("the window's own pastes go through the same check (council FS2: Send notes, kit role prompt)", () => {
  const deps = (state: string | undefined, w: ReturnType<typeof writes>) => ({ terminalOf: () => 70, stateOf: () => state, write: w.write(() => 0), sleep: async () => {} });

  it("notes sent to an agent showing a permission menu type nothing, so its Enter cannot approve it", async () => {
    const w = writes();
    expect(await pasteToPane(7, "## Notes\nfix the test", deps("permission", w))).toBe("held");
    expect(w.got).toEqual([]);
  });

  it("an agent with no hook reading gets nothing either", async () => {
    const w = writes();
    expect(await pasteToPane(7, "notes", deps(undefined, w))).toBe("held");
    expect(w.got).toEqual([]);
  });

  it("a clear agent gets one bracketed paste and an Enter, its own input line left alone", async () => {
    const w = writes();
    expect(await pasteToPane(7, "## Notes\nfix it", deps("idle", w))).toBe("sent");
    expect(w.got.map((x) => x.data)).toEqual(["\x1b[200~## Notes\rfix it\x1b[201~", "\r"]);
  });

  it("a role prompt clears the input line first, and escape codes in the text cannot close the paste", async () => {
    const w = writes();
    expect(await pasteToPane(7, "role\x1b[201~y", deps("done", w), true)).toBe("sent");
    expect(w.got.map((x) => x.data)).toEqual(["\x15", "\x1b[200~role[201~y\x1b[201~", "\r"]);
  });

  it("a one-line note that is a slash command still goes in as a paste, never as keys", async () => {
    const w = writes();
    await pasteToPane(7, "/clear", deps("idle", w));
    expect(w.got.map((x) => x.data)).toEqual(["\x1b[200~/clear\x1b[201~", "\r"]);
  });
});
