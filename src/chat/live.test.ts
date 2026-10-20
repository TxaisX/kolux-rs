// T-050-c (VIEW-019): a live agent detected in the pane decides chat or terminal over what the
// session was launched as. Rust `chat_support` weighs the detected agent over the launch record and
// reports the result as Support; liveOffer turns that into the Agents screen's offer per pane kind.
import { expect, test } from "vitest";
import { SHELL_OFFER, liveOffer, type Support } from "./model";

const seen = (agent: string): Support => ({ agent, launching: false, readable: true });
const nothing: Support = { launching: true, readable: false };

test("a shell where the user typed claude offers chat, and goes back to the shell offer when claude exits", () => {
  // program null: Kolux started no program in this pane.
  expect(liveOffer(null, "Terminal 3", seen("claude"))).toEqual({ agent: "claude", chat: true, back: false, chooser: false });
  // claude exited: nothing in front. A plain shell, never "starting".
  expect(liveOffer(null, "Terminal 3", nothing)).toEqual({ agent: undefined, ...SHELL_OFFER });
});

test("an orchestrator worker and a typed-command pane (no program) are decided by the agent in front", () => {
  // Both have program null today, so both always got the shell offer before T-050-c.
  expect(liveOffer(null, "api tests", seen("codex")).chat).toBe(true);
  expect(liveOffer(null, "api tests", seen("codex")).agent).toBe("codex");
  expect(liveOffer(undefined, "worker 2", seen("claude")).chat).toBe(true);
  // Until the typed command's agent is in front, the terminal shows and nothing waits as starting.
  expect(liveOffer(null, "api tests", nothing)).toEqual({ agent: undefined, ...SHELL_OFFER });
});

test("a launch whose program changed follows the agent now in front, not the launch record", () => {
  // Launched as claude; Rust saw codex in front and says codex.
  expect(liveOffer("claude", "Claude", seen("codex"))).toEqual({ agent: "codex", chat: true, back: false, chooser: false });
  // Launched as claude, nothing seen yet, the program has not written: still starting (the chooser).
  expect(liveOffer("claude", "Claude", { agent: "claude", launching: true, readable: true })).toEqual({ agent: "claude", chat: false, back: false, chooser: true });
  // Launched as claude and up: chat, as before T-050-c.
  expect(liveOffer("claude", "Claude", seen("claude")).chat).toBe(true);
});

test("an agent chat cannot read, or one with no transcript home here, stays a terminal even when in front", () => {
  expect(liveOffer(null, "Terminal 1", { agent: undefined, launching: false, readable: false })).toEqual({ agent: undefined, ...SHELL_OFFER });
  expect(liveOffer(null, "Terminal 1", { agent: "claude", launching: false, readable: false }).chat).toBe(false);
  expect(liveOffer("aider", "Aider", { agent: undefined, launching: false, readable: false })).toEqual({ agent: undefined, ...SHELL_OFFER });
});
