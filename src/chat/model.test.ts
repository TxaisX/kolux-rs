import { expect, test } from "vitest";
import { HAND_CAP, SHELL_OFFER, agentsView, handInto, handTargets, handText, viewedFirst, applyRead, chatCovers, chatOffer, combine, pickChat, typingInto, lastReply, previewToShow, stamp, type ChatItem, type ChatRead, type OfferInput } from "./model";

const base: OfferInput = { credited: "claude", screen: "agents", switchOn: false, showingChat: false, launching: false, readable: true };
const item = (id: string, role: ChatItem["role"], text: string, at: number): ChatItem => ({ id, role, kind: "text", text, at });
const read = (items: ChatItem[], reset = false): ChatRead => ({ state: "ready", reset, items, open: false, retryMs: 1000 });

test("CHAT-002: Claude in a pane offers chat, a plain shell does not", () => {
  expect(chatOffer(base).chat).toBe(true);
  expect(chatOffer({ ...base, credited: null }).chat).toBe(false);
});

test("CHAT-002: an unsupported agent renamed to read like Claude is still not offered chat", () => {
  expect(chatOffer({ ...base, credited: "aider", title: "Claude", hint: "claude" }).chat).toBe(false);
});

test("CHAT-002: with the switch off a Codex session renders as chat on the Agents screen but not on Terminals", () => {
  expect(chatOffer({ ...base, credited: "codex" }).chat).toBe(true);
  expect(chatOffer({ ...base, credited: "codex", screen: "terminals" }).chat).toBe(false);
  expect(chatOffer({ ...base, credited: "codex", screen: "terminals", switchOn: true }).chat).toBe(true);
});

test("CHAT-002: no readable transcript stays a terminal; a tab showing chat can always go back; launching shows the chooser; structured has no toggle", () => {
  expect(chatOffer({ ...base, readable: false }).chat).toBe(false);
  expect(chatOffer({ ...base, credited: "aider", showingChat: true })).toEqual({ chat: false, back: true, chooser: false });
  expect(chatOffer({ ...base, launching: true })).toEqual({ chat: false, back: false, chooser: true });
  expect(chatOffer({ ...base, structured: true, showingChat: true })).toEqual({ chat: true, back: false, chooser: false });
});

test("CHAT-006: a reset read replaces the view; later reads add new items and replace a grown one", () => {
  let v = applyRead([], read([item("u1", "user", "hi", 1), item("m1", "assistant", "Looking", 2)], true));
  v = applyRead(v, read([item("m1", "assistant", "Looking\n\nDone.", 2), item("u2", "user", "next", 3)]));
  expect(v.map((i) => i.text)).toEqual(["hi", "Looking\n\nDone.", "next"]);
  expect(applyRead(v, read([], true))).toEqual([]);
});

test("CHAT-010: a reply that also came through a hook is shown once, the transcript's version", () => {
  const rows = combine([item("u1", "user", "Fix it", 1000), item("m1", "assistant", "Fixed  the bug.", 2000)], [{ id: "hook-1", role: "assistant", text: "Fixed the bug.", at: 2100 }, { id: "hook-2", role: "assistant", text: "Still going", at: 3000 }], null, []);
  expect(rows.map((r) => r.id)).toEqual(["u1", "m1", "hook-2"]);
});

test("CHAT-010: messages run in time order, then by a stable identity", () => {
  const rows = combine([item("b", "assistant", "two", 5), item("a", "user", "one", 5), item("c", "user", "zero", 1)], [], null, []);
  expect(rows.map((r) => r.id)).toEqual(["c", "a", "b"]);
});

test("CHAT-010/011: the preview sits after real content and before sends the transcript has not confirmed", () => {
  const rows = combine([item("u1", "user", "first", 1000)], [], "Writing the answer", [{ id: "p1", text: "first", at: 900 }, { id: "p2", text: "second", at: 4000 }]);
  expect(rows.map((r) => `${r.row}:${r.id}`)).toEqual(["message:u1", "preview:preview", "pending:p2"]);
});

test("CHAT-011: the preview shows only in an active turn, ahead of the last reply, never tool output or blank", () => {
  expect(previewToShow({ text: "A long answer being written" }, true, undefined)).toBe("A long answer being written");
  expect(previewToShow({ text: "A long answer" }, false, undefined)).toBeNull();
  expect(previewToShow({ text: "$ npm test\nPASS", tool: true }, true, undefined)).toBeNull();
  expect(previewToShow({ text: "   " }, true, undefined)).toBeNull();
  expect(previewToShow({ text: "Done." }, true, "Done.")).toBeNull();
  expect(previewToShow({ text: "Done. And more" }, true, "Done.")).toBe("Done. And more");
});

test("CHAT-011: when the turn ends exactly one reply remains", () => {
  const items = [item("u1", "user", "Explain", 1), item("m1", "assistant", "The whole answer.", 2)];
  const shown = previewToShow({ text: "The whole answer." }, false, lastReply(items));
  expect(combine(items, [], shown, []).filter((r) => r.row !== "message" || r.role === "assistant")).toHaveLength(1);
  expect(lastReply([item("m1", "assistant", "old", 1), item("u2", "user", "new question", 2)])).toBeUndefined();
});

test("CHAT-010: timestamps follow the app's language", () => {
  const at = Date.UTC(2026, 2, 1, 15, 4);
  expect(stamp(at, "en-US").full).not.toEqual(stamp(at, "de-DE").full);
  expect(stamp(at, "de-DE").short).toMatch(/\d{1,2}:04/);
});

test("VIEW-019: a picked pane shows only its own chat, Starting while it launches, never another pane's", () => {
  const panes = [{ key: 1 }, { key: 2 }, { key: 3 }];
  const chat = { chat: true, back: false, chooser: false };
  const launching = { chat: false, back: false, chooser: true };
  const terminal = { chat: false, back: false, chooser: false };
  // Pane 3 was just added with + and is launching; pane 1 can show chat: the box must not type into 1.
  expect(pickChat(panes, 3, { 1: chat, 3: launching })).toBe("starting");
  // Its support is not known yet (the 3 s check has not run): still Starting, still not pane 1.
  expect(pickChat(panes, 3, { 1: chat })).toBe("starting");
  expect(pickChat(panes, 3, { 1: chat, 3: chat })).toEqual({ key: 3 });
  // A picked pane that cannot show chat shows its terminal (no chat), not pane 1's chat.
  expect(pickChat(panes, 2, { 1: chat, 2: terminal })).toBeNull();
  // A pick that is not a chat pane at all (a preset) shows nothing here.
  expect(pickChat(panes, 9, { 1: chat })).toBeNull();
  // Nothing picked: the first pane that can show chat.
  expect(pickChat(panes, null, { 1: terminal, 2: chat, 3: chat })).toEqual({ key: 2 });
  expect(pickChat(panes, null, {})).toBeNull();
});

test("with nothing picked the box names the pane it types into (council FIX-1, model.ts fallback)", () => {
  expect(typingInto(null, { title: "api tests" })).toBe("Typing into api tests");
  expect(typingInto(null, { title: "  " })).toBe("Typing into the first agent that can chat");
  expect(typingInto(null, {})).toBe("Typing into the first agent that can chat");
  expect(typingInto(4, { title: "api tests" })).toBeNull();
});

test("T-050-b (VIEW-019): a plain shell shows its terminal with no switch, never a Starting line", () => {
  expect(pickChat([{ key: 1 }], 1, { 1: SHELL_OFFER })).toBeNull();
  expect(agentsView(pickChat([{ key: 1 }], 1, { 1: SHELL_OFFER }), new Set())).toBe("none");
  // Nothing picked: a shell is never the chat the screen falls back to.
  expect(pickChat([{ key: 1 }, { key: 2 }], null, { 1: SHELL_OFFER, 2: { chat: true, back: false, chooser: false } })).toEqual({ key: 2 });
});

test("T-050-b (VIEW-019): Show terminal flips only the session it was flipped for", () => {
  const forced = new Set([1]);
  expect(agentsView({ key: 1 }, forced)).toBe("terminal");
  expect(agentsView({ key: 2 }, forced)).toBe("chat");
  expect(agentsView({ key: 1 }, new Set())).toBe("chat");
  expect(agentsView("starting", forced)).toBe("starting");
});

test("T-050-b: the chat covers the terminal only once the transcript is found", () => {
  expect(chatCovers("ready")).toBe(true);
  expect(chatCovers("empty")).toBe(true);
  // Not found yet (the agent may be showing a launch prompt in its terminal) or unreadable.
  expect(chatCovers("loading")).toBe(false);
  expect(chatCovers("error")).toBe(false);
});

const yes = { chat: true, back: false, chooser: false };
test("T-080 (VIEW-020): the targets are the other chat sessions, the last viewed first, capped", () => {
  const panes = [{ key: 1 }, { key: 2 }, { key: 3 }, { key: 4 }];
  const offers = { 1: yes, 2: yes, 3: yes, 4: SHELL_OFFER };
  // Two other chat sessions exist, 3 viewed last: it is listed first; the source and the shell are not.
  expect(handTargets(panes, 1, offers, [3, 1, 2]).map((p) => p.key)).toEqual([3, 2]);
  // A session never viewed comes after the viewed ones, in pane order.
  expect(handTargets(panes, 1, offers, [2]).map((p) => p.key)).toEqual([2, 3]);
  const many = Array.from({ length: HAND_CAP + 3 }, (_, i) => ({ key: i + 10 }));
  expect(handTargets(many, 1, Object.fromEntries(many.map((p) => [p.key, yes])), [])).toHaveLength(HAND_CAP);
  expect(viewedFirst([3, 1, 2], 2)).toEqual([2, 3, 1]);
});

test("T-080 (VIEW-020): a result path with a space arrives quoted, and the typed draft is kept", () => {
  expect(handText("C:\\Users\\me\\My Docs\\report.md")).toBe('"C:\\Users\\me\\My Docs\\report.md"');
  expect(handText("Wrote it to:\n/home/me/my notes/a.md\ndone")).toBe('Wrote it to:\n"/home/me/my notes/a.md"\ndone');
  // No space, already quoted, or a sentence: untouched.
  expect(handText("/home/me/a.md")).toBe("/home/me/a.md");
  expect(handText('"C:\\a b\\c.md"')).toBe('"C:\\a b\\c.md"');
  expect(handText("All tests pass now.")).toBe("All tests pass now.");
  expect(handText("/compact keeps the context small")).toBe("/compact keeps the context small");
  expect(handInto("check this:  ", "the result")).toBe("check this:\n\nthe result");
  expect(handInto("", "the result")).toBe("the result");
});
