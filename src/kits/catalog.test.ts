import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { KITS, RECALL_KEY, assignRoles, catalogueProblems, readyVendors, fillEmpty, firstDropped, isWorkbook, recalled, remember, sampleValues, unquote, type Kit } from "./catalog";
import { KitGallery, KitSetup, canStart, startValues } from "./Kits";
import { offeredAgents } from "../launch/agents";

const noop = () => {};
const kit = (id: string) => KITS.find((k) => k.id === id)!;

test("the catalogue holds six distinct kits of three roles each, with no problems", () => {
  expect(KITS.map((k) => k.id)).toEqual(["spreadsheet", "tidy-merge", "marketing", "research", "sales", "weekly"]);
  expect(KITS.every((k) => k.roles.length === 3)).toBe(true);
  expect(catalogueProblems(KITS)).toEqual([]);
  const broken: Kit = { ...kit("spreadsheet"), roles: kit("spreadsheet").roles.map((r, i) => (i ? r : { ...r, prompt: r.prompt + " {nothing}" })) };
  expect(catalogueProblems([broken]).join(" ")).toContain("nothing");
});

// The sample files themselves (the Rust side builds them in; its own test checks that list).
const onDisk = new Set(Object.keys(import.meta.glob("../../src-tauri/kits/*/*")).map((p) => p.replace("../../src-tauri/kits/", "")));

test("every sample file the catalogue names is built into the app", () => {
  for (const k of KITS) for (const i of k.inputs) if (i.kind === "file") expect(onDisk.has(`${k.id}/${i.sample}`), `${k.id}/${i.sample}`).toBe(true);
  expect(onDisk.size).toBe(7);
});

test("roles go to their preferred AI, else round the connected ones, else nobody", () => {
  const s = kit("spreadsheet");
  expect(assignRoles(s, ["claude", "codex", "grok"])).toEqual(["claude", "codex", "grok"]);
  expect(assignRoles(s, ["codex"])).toEqual(["codex", "codex", "codex"]);
  expect(assignRoles(s, ["claude", "codex"])).toEqual(["claude", "codex", "claude"]);
  expect(assignRoles(s, [])).toEqual([null, null, null]);
});

test("pasted paths lose their quotes, workbooks are spotted, a dropped folder is skipped", () => {
  expect(unquote(`"C:/data/sales.csv"`)).toBe("C:/data/sales.csv");
  expect(unquote("C:/data/sales ")).toBe("C:/data/sales ");
  expect(isWorkbook("C:/x/Book1.XLSX")).toBe(true);
  expect(isWorkbook("C:/x/book.csv")).toBe(false);
  expect(firstDropped([{ path: "C:/x", dir: true }, { path: "C:/x/a.csv", dir: false }])).toBe("C:/x/a.csv");
  expect(firstDropped([{ path: "C:/x", dir: true }])).toBe(null);
});

test("inputs are remembered per workspace and kit, blanks and unknown inputs left out", () => {
  const s = kit("spreadsheet");
  const saved = remember({}, "G:/Work/Shop", s, { data: "G:/Work/Shop/sales.csv", question: "  " });
  expect(saved[RECALL_KEY]).toEqual({ "g:/work/shop|spreadsheet": { data: "G:/Work/Shop/sales.csv" } });
  const withJunk = { [RECALL_KEY]: { "g:/work/shop|spreadsheet": { data: "a.csv", gone: "x" } } };
  expect(recalled(withJunk, "G:/WORK/Shop", s)).toEqual({ data: "a.csv" });
  expect(recalled(saved, "G:/Other", s)).toEqual({});
  expect(fillEmpty({ data: "", question: "q" }, { data: "a.csv", question: "old" })).toEqual({ data: "a.csv", question: "q" });
  expect(sampleValues(s, "G:/S/spreadsheet/").data).toBe("G:/S/spreadsheet/sales.csv");
  expect(startValues(s, "G:/S/spreadsheet", "G:/S/spreadsheet", {}).question).toBe(s.inputs[1].sample);
  expect(startValues(s, "G:/Elsewhere", "G:/S/spreadsheet", {})).toEqual({});
  // The samples folder comes back from the backend with mixed slashes; the workspace path with the other kind.
  expect(startValues(s, "G:\\S\\Spreadsheet\\", "g:/s/spreadsheet", {}).question).toBe(s.inputs[1].sample);
});

test("Start kit waits for an AI, a workspace and a real file for every required input", () => {
  const s = kit("spreadsheet");
  const v = { data: "G:/a.csv" };
  expect(canStart(s, v, { data: "file" }, ["claude"], "G:/")).toBe(true);
  expect(canStart(s, v, { data: "file" }, [], "G:/")).toBe(false);
  expect(canStart(s, v, { data: "file" }, ["claude"], null)).toBe(false);
  expect(canStart(s, v, { data: "missing" }, ["claude"], "G:/")).toBe(false);
  expect(canStart(s, { data: "G:/a.xlsx" }, { data: "file" }, ["claude"], "G:/")).toBe(false);
  expect(canStart(s, {}, {}, ["claude"], "G:/")).toBe(false);
});

test("the gallery shows six kits and who would take each role", () => {
  const html = renderToString(createElement(KitGallery, { connected: ["claude"], onPick: noop, onClose: noop }));
  expect(html.match(/class="kit-card"/g)?.length).toBe(6);
  expect(html).toContain("Starter kits");
  expect(html).not.toContain("not connected");
  expect(html).not.toContain(">Codex<");
  const none = renderToString(createElement(KitGallery, { connected: [], onPick: noop, onClose: noop }));
  expect(none).toContain("not connected");
});

test("a kit's setup warns about a workbook and with no AI keeps Start kit off", () => {
  const s = kit("spreadsheet");
  const settings = remember({}, "G:/Work", s, { data: "G:/Work/Book1.xlsx" });
  const html = renderToString(createElement(KitSetup, { kit: s, connected: [], dir: "G:/Work", sampleDir: null, settings, samplesBusy: false, onSamples: noop, onStart: noop, onBack: noop, onClose: noop }));
  expect(html).toContain("This is an Excel workbook");
  expect(html).toContain("Connect Claude, Codex or Grok first");
  expect(html).toMatch(/<button class="btn primary" disabled="">Start kit/);
  expect(html).toContain("kit-results");
});

test("T-207-b ONB-005: kits only count and cast the AIs that are installed and switched on", () => {
  const list = [
    { id: "claude", name: "Claude Code", program: "claude", args: [], installed: true, path: "c" },
    { id: "codex", name: "Codex", program: "codex", args: [], installed: true, path: "x" },
    { id: "grok", name: "Grok", program: "grok", args: [], installed: false, path: null },
  ];
  expect(readyVendors(offeredAgents(list, {}))).toEqual(["claude", "codex"]);
  // Codex switched off on the Agents page: no kit role goes to it and it does not make an AI "ready".
  expect(readyVendors(offeredAgents(list, { disabledAgents: ["codex"] }))).toEqual(["claude"]);
  expect(readyVendors(offeredAgents(list, { disabledAgents: ["claude", "codex"] }))).toEqual([]);
});
