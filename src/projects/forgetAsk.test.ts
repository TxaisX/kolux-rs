// After-list row 364: the delete shortcut on a folder workspace (a row with no commit) asks before it takes the row out of Kolux.
import { createElement, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, byText, click, find, installDom, mount, settle } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({ wt: [] as unknown[], calls: [] as { cmd: string; args: unknown }[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => {
    h.calls.push({ cmd, args });
    if (cmd === "project_list") return Promise.resolve([{ id: "p1", name: "app", path: "C:/w/app" }]);
    if (cmd === "workspace_scan") return Promise.resolve({ list: h.wt, unseen: [] });
    if (cmd === "workspaces_place_get") return Promise.resolve({ dir: "", flat: false, used: [], fromEnv: false });
    if (cmd === "setup_suggestion") return Promise.resolve({ kind: "none" });
    if (cmd === "groups_get" || cmd === "activity_get" || cmd === "project_icons_list") return Promise.resolve({});
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

const base = { branch: "", hidden: false, number: null, comment: "" };
const main = { ...base, path: "C:/w/app", branch: "main", head: "abc1234", isMain: true };
const folder = { ...base, path: "C:/notes/drafts", head: "", isMain: false };
let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
let pressDelete: () => Promise<void> = async () => {};

beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  // the row under the pointer is the folder workspace
  Object.assign(doc, { querySelectorAll: () => [{ dataset: { path: folder.path } }], querySelector: () => null, visibilityState: "visible", hidden: false });
  h.wt = [main, folder];
  h.calls = [];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function panel() {
  const { default: ProjectsPanel } = await import("./ProjectsPanel");
  const { act } = await import("react");
  const props = {
    openDirs: ["C:/w/app"], sessions: [], states: {}, unread: new Set<string>(), onUnread: () => {}, settings: {}, onSetting: () => {},
    activeDir: "C:/w/app", onSelect: () => {}, onRemoved: () => {}, onSleep: () => {}, agents: [], launching: false, onLaunch: () => {},
    defaultId: "claude", onSetDefault: () => {}, onChoose: () => {}, page: null, onPage: () => {}, refresh: 0, onIndex: () => {},
    createRequest: 0, onStartIn: () => {}, nest: true, onNest: () => {}, artifactsOn: false, onArtifacts: () => {},
  };
  // the host raises deleteRequest the way App does when the delete shortcut is pressed
  const Host = () => {
    const [n, setN] = useState(0);
    pressDelete = async () => {
      await act(async () => setN(1));
      await settle(60);
    };
    return createElement(ProjectsPanel, { ...props, deleteRequest: n } as never);
  };
  const m = await mount(createElement(Host), doc);
  unmount = m.unmount;
  await settle(120);
  return m.container as FakeNode;
}
const forgets = () => h.calls.filter((c) => c.cmd === "workspace_forget");
const question = (c: FakeNode) => find(c, (n) => n.localName === "div" && String(n.attrs.className ?? n.attrs.class ?? "").includes("sb-form") && n.textContent.includes("out of Kolux"));

test("the shortcut on a folder workspace asks first and takes nothing out until the answer is yes", async () => {
  const c = await panel();
  await pressDelete();
  expect(forgets()).toEqual([]);
  expect(question(c).length).toBe(1);
  expect(question(c)[0].textContent).toMatch(/folder stays on disk/i);
  await click(c, byText(c, "button", "Take out")[0]);
  await settle(60);
  expect(forgets()).toEqual([{ cmd: "workspace_forget", args: { projectId: "p1", path: folder.path } }]);
});

test("answering Keep (or never answering) invokes nothing", async () => {
  const c = await panel();
  await pressDelete();
  await click(c, byText(c, "button", "Keep")[0]);
  await settle(60);
  expect(question(c).length).toBe(0);
  expect(forgets()).toEqual([]);
});
