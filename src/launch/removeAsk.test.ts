// VIEW-036: Bind remove, press it -> a confirmation appears before any pane closes.
import { expect, test } from "vitest";
import { removeShortcutAsk } from "./removeAsk";
import { removePlan, type SessionKind } from "../terminal/remove";

const kinds: SessionKind[] = ["unstarted", "agent", "shell", "idle", "ended"];

test("every kind of pane gets a question, even where the close button would remove it at once", () => {
  for (const kind of kinds) {
    const ask = removeShortcutAsk("Terminal 2", kind);
    expect(ask.title).toContain("Terminal 2");
    expect(ask.body.length).toBeGreaterThan(0);
    expect(ask.confirm.length).toBeGreaterThan(0);
  }
  // the quieter plan the close button uses removes these without a question; the shortcut does not follow it
  expect(removePlan({}, "unstarted")).toBe("remove");
  expect(removePlan({}, "idle")).toBe("remove");
  expect(removePlan({ removeStartedSession: "stop" }, "agent")).toBe("stop");
});

test("an empty chooser is asked about and the question says nothing has started", () => {
  const ask = removeShortcutAsk("Terminal 3", "unstarted");
  expect(ask.confirm).toBe("Remove");
  expect(ask.body).toContain("No session has started");
});

test("a running agent or busy shell keeps the stop wording", () => {
  expect(removeShortcutAsk("Claude", "agent")).toMatchObject({ confirm: "Stop", title: "Stop “Claude”?" });
  expect(removeShortcutAsk("Terminal 1", "shell").body).toContain("still running");
});
