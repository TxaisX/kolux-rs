import { expect, test } from "vitest";
import { botsText, botToggle, MAX_BOTS, onBotList, parseBots, relabelAsBot, toggleBotIn, withBot, withoutBot } from "./reviewBots";

test("ACCT-058: typed names become a tidy list: @ and [bot] dropped, repeats once, junk skipped", () => {
  expect(parseBots("@Dependabot[bot], renovate  ci-bot;\nDEPENDABOT")).toEqual(["Dependabot", "renovate", "ci-bot"]);
  expect(parseBots("   ")).toEqual([]);
  expect(parseBots("a/b !!! ok_1.x")).toEqual(["ok_1.x"]);
  expect(parseBots("x".repeat(61))).toEqual([]);
});

test("ACCT-058: the list is capped", () => {
  const many = Array.from({ length: MAX_BOTS + 10 }, (_, i) => `bot${i}`).join(" ");
  expect(parseBots(many)).toHaveLength(MAX_BOTS);
});

test("ACCT-058: the field shows the saved list; a list on it marks the author as a bot, others stay people", () => {
  expect(botsText(["a", 3, "b"])).toBe("a, b");
  expect(botsText(undefined)).toBe("");
  const list = parseBots("ReviewBot");
  expect(onBotList("reviewbot", list)).toBe(true);
  expect(onBotList("alice", list)).toBe(false);
  expect(onBotList("reviewbot2", list)).toBe(false);
});

test("marking one author from a card adds a name once, tidied, and takes it off in any case", () => {
  expect(withBot(["ci"], "@Dependabot[bot]")).toEqual(["ci", "Dependabot"]);
  expect(withBot(["ci", "Dependabot"], "dependabot")).toEqual(["ci", "Dependabot"]);
  expect(withBot([], "not a name")).toEqual([]);
  expect(withoutBot(["ci", "Dependabot"], "DEPENDABOT")).toEqual(["ci"]);
  expect(withoutBot(["ci"], "ann")).toEqual(["ci"]);
});

// Row 913 (leftovers of rows 247/248): the Mark as bot / Not a bot control on a comment card.
const card = (author: string, bot: boolean) => ({ author, bot });

test("row 913 (a): an author GitHub already marks as a bot gets no Mark as bot; a listed one can be taken off", () => {
  expect(botToggle(true, "dependabot", [])).toBeNull();
  expect(botToggle(false, "alice", [])).toBe("mark");
  expect(botToggle(true, "ci", ["CI"])).toBe("unmark");
});

test("row 913 (b): at the longest list a mark is refused with a message and the list is left alone", () => {
  const full = Array.from({ length: MAX_BOTS }, (_, i) => `bot${i}`);
  const cell = { current: full };
  const r = toggleBotIn(cell, "newbot");
  expect(r.changed).toBe(false);
  expect(r.note).toContain(String(MAX_BOTS));
  expect(cell.current).toBe(full);
  expect(toggleBotIn(cell, "bot3").changed).toBe(true); // taking one off still works at the cap
});

test("row 913 (c): two marks before the page redraws both land", () => {
  const cell = { current: [] as readonly string[] };
  const first = toggleBotIn(cell, "alice-bot");
  const second = toggleBotIn(cell, "Bob-Bot");
  expect(first).toMatchObject({ changed: true, marked: true, note: null });
  expect(second.list).toEqual(["alice-bot", "Bob-Bot"]);
  expect(cell.current).toEqual(["alice-bot", "Bob-Bot"]);
  expect(toggleBotIn(cell, "ALICE-BOT")).toMatchObject({ changed: true, marked: false, list: ["Bob-Bot"] });
});

test("row 913 (d): marking relabels that author's cards in place, in threads and the conversation, any case", () => {
  const review = { threads: [{ id: "t", comments: [card("Alice", false), card("bob", false)] }], talk: [card("ALICE", false), card("carol", false)], talk_more: 0 };
  const out = relabelAsBot(review, "alice");
  expect(out.threads[0].comments.map((c) => c.bot)).toEqual([true, false]);
  expect(out.talk.map((c) => c.bot)).toEqual([true, false]);
  expect(out.talk_more).toBe(0);
  expect(review.talk[0].bot).toBe(false); // the read answer itself is not changed
});
