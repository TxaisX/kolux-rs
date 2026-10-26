// VIEW-019 acceptance (boxes 1-2): the real liveOffer -> pickChat -> agentsView chain that AgentsChat runs, fed by
// what Rust chat_support reports (Support). MIRROR src/chat/ChatView.tsx:436-444 (flip adds/removes the key in `forced`)
// and :450 (offers[key] = liveOffer(program, title, support)). Box 3 is proven by src/chat/box.test.ts and send.test.ts.
import { expect, test } from "vitest";
import { agentsView, liveOffer, pickChat, type Offer, type Support } from "../model";

const view = (panes: { key: number; program: string | null }[], picked: number, support: Record<number, Support>, forced: Set<number>) => {
  const offers: Record<number, Offer> = Object.fromEntries(panes.map((p) => [p.key, liveOffer(p.program, undefined, support[p.key])]));
  return agentsView(pickChat(panes, picked, offers), forced);
};

test("box 1: a Claude session shows its chat; flipping Show terminal shows the raw terminal, flipping back restores the chat", () => {
  const panes = [{ key: 1, program: "claude" }, { key: 2, program: null }];
  const support: Record<number, Support> = { 1: { agent: "claude", launching: false, readable: true }, 2: { launching: false, readable: false } };
  const forced = new Set<number>();
  expect(view(panes, 1, support, forced)).toBe("chat");
  forced.add(1); // the switch on
  expect(view(panes, 1, support, forced)).toBe("terminal");
  forced.delete(1); // the switch off
  expect(view(panes, 1, support, forced)).toBe("chat");
});

test("box 2: a plain shell shows its terminal with no switch (no chat view at all), never a Starting line", () => {
  const panes = [{ key: 1, program: "claude" }, { key: 2, program: null }];
  const support: Record<number, Support> = { 1: { agent: "claude", launching: false, readable: true }, 2: { launching: false, readable: false } };
  expect(view(panes, 2, support, new Set())).toBe("none"); // AgentsChat returns null for "none": no chat, no TerminalSwitch
  // Even with the other session flipped to terminal, the shell stays "none".
  expect(view(panes, 2, support, new Set([1]))).toBe("none");
  // A shell that was launched with a program Kolux cannot chat with (unsupported agent) also gets the terminal.
  expect(view([{ key: 3, program: "aider" }], 3, { 3: { launching: false, readable: false } }, new Set())).toBe("none");
});
