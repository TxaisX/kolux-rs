import { expect, test } from "vitest";
import { botsText, MAX_BOTS, onBotList, parseBots } from "./reviewBots";

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
