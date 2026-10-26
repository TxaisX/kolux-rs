// AUTO-016 acceptance. The real AutomationsPage runs with its state kept by shallow-react.ts and the backend replaced
// by a recorder; the search, sort and empty-state decisions are made by the page's own filter chain (model.ts matches,
// passes, sortRows, lastRun) and its error branch, not by anything re-typed here.
import { expect, test, vi } from "vitest";
import AutomationsPage, { type Data } from "../AutomationsPage";
import { everyString, find, findAll, mount, textOf, type El } from "../../settings/__cards__/shallow-react";

vi.mock("react", async (orig) => {
  const patched = (await import("../../settings/__cards__/shallow-react")).patchReact(await orig<object>());
  const useMemo = <T>(f: () => T) => f();
  return { ...patched, useMemo, default: { ...(patched as { default: object }).default, useMemo } };
});
const h = vi.hoisted(() => ({ calls: [] as [string, any][], reply: {} as Record<string, unknown>, fail: {} as Record<string, string> }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: any) => {
    h.calls.push([cmd, args]);
    if (cmd in h.fail) return Promise.reject(h.fail[cmd]);
    return cmd in h.reply ? Promise.resolve(h.reply[cmd]) : new Promise(() => {});
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));
vi.stubGlobal("window", { setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {} });

const projects = [{ id: "p1", name: "shop", path: "C:\src\shop", base: "main" }];
const settle = () => new Promise((r) => setTimeout(r, 5));
const mk = (id: string, name: string, prompt: string) => ({ id, name, prompt, provider: "claude", projectId: "p1", enabled: true, trigger: { kind: "schedule", cron: "0 9 * * *", timezone: "UTC" } }) as never;
const props = (initial: { data?: Data; error?: string }) => ({ projects, agents: [], settings: {}, onSettings: () => {}, initial }) as never;
const shownIds = (tree: El) => findAll(tree, (e) => e.type === "tr" && e.props["data-id"] !== undefined).map((e) => e.props["data-id"] as string);

test("box 1: a word that appears only inside one automation's prompt leaves just that automation in the table", () => {
  const data: Data = { automations: [mk("auto-1", "Nightly checks", "run the linter"), mk("auto-2", "Weekly digest", "summarise the changelog for zebrafish habitat"), mk("auto-3", "Morning triage", "sort the inbox")], runs: [] };
  const page = mount(AutomationsPage, props({ data }));
  expect(shownIds(page.render()).sort()).toEqual(["auto-1", "auto-2", "auto-3"]);
  find(page.render(), (e) => e.type === "input" && e.props["aria-label"] === "Search automations").props.onChange({ target: { value: "  ZebraFish " } });
  const tree = page.render();
  expect(shownIds(tree)).toEqual(["auto-2"]);
  expect(everyString(tree).join("|")).toContain("Weekly digest");
});

test("box 2: sorting by Last run lists the newest run first and puts the automations that never ran at the bottom", () => {
  const data: Data = {
    automations: [mk("auto-1", "Alpha never", "x"), mk("auto-2", "Bravo old", "x"), mk("auto-3", "Charlie new", "x"), mk("auto-4", "Delta never", "x")],
    runs: [
      { id: "run-1", automationId: "auto-2", number: 1, trigger: "manual", status: "completed", at: 1_000 },
      { id: "run-2", automationId: "auto-3", number: 1, trigger: "manual", status: "completed", at: 9_000 },
    ] as never,
  };
  const page = mount(AutomationsPage, props({ data }));
  expect(shownIds(page.render())).toEqual(["auto-1", "auto-2", "auto-3", "auto-4"]); // by name to begin with
  const header = find(page.render(), (e) => e.type === "button" && textOf(e).startsWith("Last run"));
  header.props.onClick();
  const tree = page.render();
  expect(shownIds(tree)).toEqual(["auto-3", "auto-2", "auto-1", "auto-4"]);
  expect(find(tree, (e) => e.type === "th" && e.props["aria-sort"] !== "none").props["aria-sort"]).toBe("ascending");
});

test("box 3: a load that fails shows the error with Retry, never the nothing-created message, until a Retry succeeds", async () => {
  h.calls.length = 0;
  h.reply = {};
  h.fail = {};
  const page = mount(AutomationsPage, props({ error: "the backend did not answer" }));
  let tree = page.render();
  expect(textOf(find(tree, (e) => e.props?.role === "alert"))).toContain("Automations could not be loaded");
  expect(textOf(find(tree, (e) => e.props?.role === "alert"))).toContain("the backend did not answer");
  expect(everyString(tree).join("|")).not.toContain("No automations yet");
  // Retry asks again; while the back end keeps failing the error stays and the page still does not claim the list is empty.
  h.fail = { automations_list: "still down" };
  find(tree, (e) => e.type === "button" && textOf(e) === "Retry").props.onClick();
  await settle();
  tree = page.render();
  expect(h.calls.filter(([c]) => c === "automations_list").length).toBe(1);
  expect(textOf(find(tree, (e) => e.props?.role === "alert"))).toContain("still down");
  expect(everyString(tree).join("|")).not.toContain("No automations yet");
  // Once the back end answers, the error is gone and the real list (here, genuinely empty) is shown.
  h.fail = {};
  h.reply = { automations_list: { automations: [], runs: [] } };
  find(tree, (e) => e.type === "button" && textOf(e) === "Retry").props.onClick();
  await settle();
  tree = page.render();
  expect(findAll(tree, (e) => e.props?.role === "alert")).toEqual([]);
  expect(everyString(tree).join("|")).toContain("No automations yet");
});
