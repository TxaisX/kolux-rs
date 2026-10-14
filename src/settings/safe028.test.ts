// SAFE-028: what a restart reads back from settings.json. Each case goes through JSON, as the file does.
import { expect, test } from "vitest";
import { readNotifications } from "./notifications";
import { readAppearance, writeAppearance } from "../theme";
import { readRight } from "../chrome/RightSidebar";

const reload = (s: Record<string, unknown>) => JSON.parse(JSON.stringify(s)) as Record<string, unknown>;

test("a saved volume is held to its range, and one that is not a number is the default", () => {
  const vol = (v: unknown) => readNotifications(reload({ notificationVolume: v })).volume;
  expect([vol(5000), vol(101), vol(-3), vol(42.4), vol(0), vol(100)]).toEqual([100, 100, 0, 42, 0, 100]);
  expect([vol("loud"), vol(null), vol(true), vol(undefined)]).toEqual([100, 100, 100, 100]);
  expect(readNotifications(reload({ notificationSound: "ping", notificationVolume: 30 }))).toMatchObject({ sound: "ping", volume: 30 });
});

test("terminal themes come back by name, and a light-mode terminal theme left off stays off", () => {
  const chosen = { ...readAppearance({}), terminal: "gruvbox-dark", lightTerminal: false, lightScheme: "solarized-light" };
  const back = readAppearance(reload(writeAppearance({}, chosen)));
  expect([back.terminal, back.lightTerminal, back.lightScheme]).toEqual(["gruvbox-dark", false, "solarized-light"]);
  // A name this version cannot draw falls back instead of breaking the pane.
  expect(readAppearance(reload({ terminalScheme: "no-such-scheme" })).terminal).toBe("default");
});

test("the right sidebar's open setting is read back as saved", () => {
  expect([readRight(reload({ rightSidebarOpen: false })).open, readRight(reload({})).open]).toEqual([false, true]);
});
