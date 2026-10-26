// EDIT-041 box 2: a permission item whose terminal has exited shows Answer in Code and no inline answer buttons;
// the same item with a live terminal does get its inline buttons (so the contrast is the exit, not a missing read).
// Real InboxView + Detail components run with no DOM; effects run once, right after the first render.
// MIRROR none for the box (Detail owns canRead and the buttons). Box 1 (Code view, worktree, pane focus) is App.tsx openPane glue: LIVE.
import { beforeEach, describe, expect, it, vi } from "vitest";
import InboxView from "../InboxView";
import { inboxItems, type Source } from "../inbox";
import { find, findAll, mount, textOf, type El } from "../../settings/__cards__/shallow-react";

const h = vi.hoisted(() => ({ armed: false, calls: [] as string[] }));
vi.mock("react", async (orig) => {
  const patched = (await import("../../settings/__cards__/shallow-react")).patchReact(await orig<object>());
  const useEffect = (f: () => void) => {
    if (h.armed) f();
  };
  const useMemo = <T>(f: () => T) => f();
  return { ...patched, useEffect, useMemo, default: { ...(patched as { default: object }).default, useEffect, useMemo } };
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    h.calls.push(cmd);
    if (cmd === "prompt_read") return { prompt: { kind: "permission", text: "Run npm test?", options: ["Yes", "No"] }, choices: [{ label: "Allow", keys: "1" }, { label: "Deny", keys: "3" }] };
    if (cmd === "agent_history") return [];
    throw new Error("no repo");
  },
}));
beforeEach(() => {
  h.calls.length = 0;
  h.armed = false;
});

const MIN = 60_000;
const now = 10_000 * MIN;
const src = (key: number, extra: Partial<Source> = {}): Source => ({ key, agent: "claude", title: `Claude ${key}`, branch: "main", cwd: "G:/repo", state: "permission", interrupted: false, running: true, changed: now - MIN, finishedAt: null, ...extra });

async function detailFor(sources: Source[]) {
  const top = mount(InboxView, { items: inboxItems(sources, now), now, onOpen: () => {} }, { 0: sources[0].key }).render(); // slot 0: the selected row
  const d = find(top, (e) => typeof e.type === "function" && e.props.item !== undefined);
  h.armed = true; // the first render runs the effects
  const m = mount(d.type as never, d.props as never);
  let tree = m.render();
  h.armed = false;
  await new Promise((r) => setTimeout(r, 0)); // let prompt_read / agent_history settle
  tree = m.render();
  return tree;
}
const buttons = (tree: El) => findAll(tree, (e) => e.type === "button").map((b) => textOf(b));

describe("EDIT-041 box 2", () => {
  it("a permission whose terminal has exited: the only button is Answer in Code, no inline answers, the prompt is never read", async () => {
    const tree = await detailFor([src(1, { running: false })]);
    expect(buttons(tree)).toEqual(["Answer in Code"]);
    expect(findAll(tree, (e) => e.props["data-prompt"] !== undefined)).toHaveLength(0);
    expect(h.calls).not.toContain("prompt_read");
    expect(textOf(find(tree, (e) => e.props.className === "exited"))).toMatch(/terminal has exited.*Answer in Code/);
  });
  it("the same permission with a live terminal is read and offers its answers inline, plus the Answer in Code button", async () => {
    const tree = await detailFor([src(2)]);
    expect(h.calls).toContain("prompt_read");
    expect(buttons(tree)).toEqual(["Allow", "Deny", "Answer in Code"]);
  });
});
