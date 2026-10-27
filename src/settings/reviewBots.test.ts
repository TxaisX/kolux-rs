import { expect, test } from "vitest";
import { botsText, MAX_BOTS, onBotList, parseBots, withBot, withoutBot } from "./reviewBots";

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
