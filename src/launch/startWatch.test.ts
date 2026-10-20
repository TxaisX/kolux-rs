// SESS-005 / SESS-032 (T-163): the no-process watch and the opening-prompt words, with fake timers
// and a fake Rust side.
import { expect, test } from "vitest";
import { deliverPrompt, NO_PROCESS_MS, noProcessWarning, promptLost, StartWatch } from "./startWatch";

/** Timers under test: `fire(ms)` runs every timer due by then, in order. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const due = new Map<number, { at: number; f: () => void }>();
  return {
    timers: {
      set: (f: () => void, ms: number) => {
        const id = next++;
        due.set(id, { at: now + ms, f });
        return id;
      },
      clear: (t: unknown) => void due.delete(t as number),
    },
    fire(ms: number) {
      now += ms;
      for (const [id, t] of [...due].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at > now) break;
        due.delete(id);
        t.f();
      }
    },
    get pending() {
      return due.size;
    },
  };
}

test("SESS-005: a pane with no process after five seconds gets one warning naming the agent", () => {
  const t = fakeTimers();
  const w = new StartWatch(t.timers);
  const said: string[] = [];
  w.arm(7, "Claude Code", (s) => said.push(s));
  w.arm(7, "Claude Code", (s) => said.push(s)); // armed once, whatever the render count
  expect(w.watching).toEqual([7]);
  t.fire(NO_PROCESS_MS - 1);
  expect(said).toEqual([]);
  t.fire(1);
  expect(said).toEqual([noProcessWarning("Claude Code")]);
  expect(said[0]).toBe("Claude Code has not started: no terminal process appeared after 5 seconds. Check its command under Settings > Agents.");
  // Once said, the same pane is never armed or warned again.
  w.arm(7, "Claude Code", (s) => said.push(s));
  t.fire(NO_PROCESS_MS);
  expect(said).toHaveLength(1);
  expect(w.watching).toEqual([]);
});

test("SESS-005: a process that shows up stops the watch; a slow-to-paint agent is never warned about", () => {
  const t = fakeTimers();
  const w = new StartWatch(t.timers);
  const said: string[] = [];
  w.arm(1, "Codex", (s) => said.push(s));
  w.arm(2, "Aider", (s) => said.push(s));
  t.fire(4000);
  w.seen(1); // the pane reported its terminal id at 4 s; it may paint much later
  t.fire(NO_PROCESS_MS);
  expect(said).toEqual([noProcessWarning("Aider")]);
  // Seen before armed (a restored pane that attached at once): arming is a no-op.
  w.seen(3);
  w.arm(3, "Grok", (s) => said.push(s));
  expect(w.watching).toEqual([]);
  t.fire(NO_PROCESS_MS);
  expect(said).toHaveLength(1);
});

test("SESS-005: pruning to the shown panes clears their timers, and a pane shown again starts afresh", () => {
  const t = fakeTimers();
  const w = new StartWatch(t.timers);
  const said: string[] = [];
  w.arm(5, "Claude Code", (s) => said.push(s));
  w.arm(6, "Codex", (s) => said.push(s));
  w.seen(6);
  w.prune([5]);
  expect(w.watching).toEqual([5]);
  w.prune([]);
  expect(w.watching).toEqual([]);
  expect(t.pending).toBe(0);
  t.fire(NO_PROCESS_MS);
  expect(said).toEqual([]);
  // Forgotten panes (5 unseen, 6 seen) are new panes when shown again.
  w.arm(6, "Codex", (s) => said.push(s));
  expect(w.watching).toEqual([6]);
  t.fire(NO_PROCESS_MS);
  expect(said).toEqual([noProcessWarning("Codex")]);
});

test("SESS-032: a prompt that went in says nothing; one that did not says why and what to do", () => {
  expect(promptLost("Claude Code", { outcome: "sent", why: null })).toBeNull();
  expect(promptLost("Claude Code", { outcome: "duplicate", why: null })).toBeNull();
  expect(promptLost("Claude Code", { outcome: "gone", why: "the program ended before it could take input" })).toBe(
    "Claude Code's opening prompt was not sent: the program ended before it could take input. Type it into its terminal yourself.",
  );
  expect(promptLost("Codex", { outcome: "held_permission", why: "a permission prompt (Allow command) appeared while the prompt was typed, so Enter was held back" })).toBe(
    "Codex's opening prompt was not sent: a permission prompt (Allow command) appeared while the prompt was typed, so Enter was held back. It is typed in its terminal; press Enter there to send it.",
  );
  expect(promptLost("Aider", { outcome: "failed", why: null })).toBe("Aider's opening prompt was not sent. Type it into its terminal yourself.");
});

test("SESS-032: the hand-over asks Rust once per terminal with the whole prompt, and a failed call is a prompt not sent", async () => {
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  const invoke = async <T>(cmd: string, args: Record<string, unknown>): Promise<T> => {
    calls.push({ cmd, args });
    return (calls.length === 1 ? { outcome: "sent", why: null } : { outcome: "duplicate", why: null }) as T;
  };
  const text = "fix the build\nthen run the tests";
  expect(await deliverPrompt(invoke, 42, text, "Claude Code")).toBeNull();
  expect(calls).toEqual([{ cmd: "agent_prompt_send", args: { id: 42, text } }]);
  expect(await deliverPrompt(invoke, 42, text, "Claude Code")).toBeNull();
  expect(calls).toHaveLength(2);
  const broken = async <T>(): Promise<T> => {
    throw new Error("no such terminal");
  };
  expect(await deliverPrompt(broken, 42, text, "Claude Code")).toBe("Claude Code's opening prompt was not sent: Error: no such terminal. Type it into its terminal yourself.");
});
