import { expect, test } from "vitest";
import type { WriterOptions } from "../scm/writerPick";
import { DEFAULT_MODELS, listFor, rememberedLists, rememberPatch, sourceNote, WRITER_MODELS_KEY } from "./writerModels";

const opts = (agent: string, installed: boolean, ids: string[]): WriterOptions => ({ agent, name: agent, installed, models: ids.map((id) => ({ id, name: id, efforts: [] })), efforts: [], hint: null });

test("ACCT-033: the list comes from the installed tool when it answers", () => {
  const o = opts("codex", true, ["gpt-x", "gpt-y"]);
  const r = listFor(o, { codex: [{ id: "old", name: "old", efforts: [] }] });
  expect(r.source).toBe("installed");
  expect(r.options.models.map((m) => m.id)).toEqual(["gpt-x", "gpt-y"]);
});

test("ACCT-033: when the tool cannot be asked, the list it gave last time is offered", () => {
  const r = listFor(opts("codex", true, []), { codex: [{ id: "gpt-x", name: "GPT X", efforts: ["low"] }] });
  expect(r.source).toBe("remembered");
  expect(r.options.models).toEqual([{ id: "gpt-x", name: "GPT X", efforts: ["low"] }]);
  expect(sourceNote(r.source, "Codex")).toMatch(/last time/);
});

test("ACCT-033: with nothing remembered the built-in list is offered; an agent with none gets an empty list", () => {
  const r = listFor(opts("claude", true, []), {});
  expect(r.source).toBe("default");
  expect(r.options.models.map((m) => m.id)).toEqual(DEFAULT_MODELS.claude.map((m) => m.id));
  expect(sourceNote(r.source, "Claude Code")).toMatch(/built-in/);
  expect(listFor(opts("pi", true, []), {}).options.models).toEqual([]);
  expect(sourceNote("installed", "x")).toBeNull();
});

test("ACCT-033: Grok is not asked and keeps its fixed default", () => {
  expect(listFor(opts("grok", true, []), {}).options.models.map((m) => m.id)).toEqual(["grok-code-fast-1"]);
});

test("ACCT-033: a live list is remembered per agent, once", () => {
  const o = opts("cursor", true, ["auto", "m2"]);
  const p = rememberPatch(o, { codex: [{ id: "a", name: "a", efforts: [] }] });
  expect(Object.keys((p as Record<string, Record<string, unknown>>)[WRITER_MODELS_KEY])).toEqual(["codex", "cursor"]);
  expect(rememberPatch(o, rememberedLists(p as Record<string, unknown>))).toBeNull(); // already remembered: no save loop
  expect(rememberPatch(opts("cursor", true, []), {})).toBeNull(); // a failed discovery never overwrites
  expect(rememberPatch(opts("cursor", false, ["x"]), {})).toBeNull();
});

test("ACCT-033: remembered lists out of the settings drop anything malformed", () => {
  expect(rememberedLists({})).toEqual({});
  expect(rememberedLists({ [WRITER_MODELS_KEY]: ["x"] })).toEqual({});
  expect(rememberedLists({ [WRITER_MODELS_KEY]: { codex: [{ id: "a" }, { id: "" }, 3, { id: "b", name: "B", efforts: ["low", 4] }], pi: "no", grok: [] } })).toEqual({
    codex: [
      { id: "a", name: "a", efforts: [] },
      { id: "b", name: "B", efforts: ["low"] },
    ],
  });
});
