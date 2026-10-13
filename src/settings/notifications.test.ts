import { expect, test } from "vitest";
import { readNotifications, testPlan } from "./notifications";

test("SET-034: with nothing saved, every kind is on except the bell, focused worktrees stay quiet, full volume, system sound", () => {
  const n = readNotifications({});
  // one switch per kind: the finish and stop kinds are the keys the notifications read (STAT-041, STAT-023)
  expect(n.kinds).toEqual({ notifyOnFinish: true, notifyBell: false, notifyOnStopped: true });
  expect(n.suppressFocused).toBe(true);
  expect(n.sound).toBe("system");
  expect(n.volume).toBe(100);
});

test("SET-034: saved choices are read back; a broken volume or sound falls back to the default", () => {
  const n = readNotifications({ notifyBell: true, notifyOnStopped: false, notificationSound: "chime", notificationVolume: 35 });
  expect(n.kinds.notifyBell).toBe(true);
  expect(n.kinds.notifyOnStopped).toBe(false);
  expect(n.sound).toBe("chime");
  expect(n.volume).toBe(35);
  expect(readNotifications({ notificationVolume: 400, notificationSound: "trumpet" })).toMatchObject({ volume: 100, sound: "system" });
  expect(readNotifications({ notificationVolume: "loud" }).volume).toBe(100);
});

test("SET-034: the test plays one sound: Kolux's tone with a silent toast, or the system sound; volume 0 is silent", () => {
  expect(testPlan({ sound: "chime", volume: 40 })).toEqual({ toastSound: false, tone: "chime", gain: 0.4 });
  expect(testPlan({ sound: "system", volume: 80 })).toEqual({ toastSound: true, tone: null, gain: 0.8 });
  expect(testPlan({ sound: "chime", volume: 0 })).toEqual({ toastSound: false, tone: null, gain: 0 });
  expect(testPlan({ sound: "system", volume: 0 })).toEqual({ toastSound: false, tone: null, gain: 0 });
});

test("SET-034: the page lists the kinds, the sound and volume, the test button and the system link", async () => {
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { NotificationsView } = await import("./NotificationsPage");
  const html = renderToString(createElement(NotificationsView, { settings: { notificationVolume: 0 }, onSave: () => {} }));
  for (const t of ["An agent finishes its task", "A terminal rings its bell", "Usage alerts", "Stay quiet about the worktree you are looking at", "System default", "Silent", "Send a test notification", "System notification settings"]) expect(html).toContain(t);
});
