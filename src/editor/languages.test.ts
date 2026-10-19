import { StringStream } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { jsonLineToken, languageFor, nimToken } from "./languages";

const tokens = (line: string, token: typeof jsonLineToken) => {
  const s = new StringStream(line, 4, 2);
  const out: [string, string | null][] = [];
  while (!s.eol()) {
    s.start = s.pos;
    const t = token(s);
    if (s.pos === s.start) throw new Error("tokenizer did not advance");
    if (t) out.push([s.current(), t]);
  }
  return out;
};

describe("extra languages (EDIT-010)", () => {
  it("knows Astro, Svelte, Vue, Nim and JSON Lines by file name, and leaves JSON alone", () => {
    expect(languageFor("Page.astro")?.name).toBe("Astro");
    expect(languageFor("App.svelte")?.name).toBe("Svelte");
    expect(languageFor("Card.vue")?.name).toBe("Vue");
    expect(languageFor("main.nim")?.name).toBe("Nim");
    expect(languageFor("events.jsonl")?.name).toBe("JSON Lines");
    expect(languageFor("events.NDJSON")?.name).toBe("JSON Lines");
    expect(languageFor("data.json")?.name).toBe("JSON");
    expect(languageFor("notes.unknownext")).toBeNull();
  });

  it("colours every JSON Lines line as JSON: keys, strings, numbers, atoms, brackets", () => {
    expect(tokens('{"id": 12, "ok": true, "tag": "a\\"b", "n": null, "xs": [-1.5e3]}', jsonLineToken)).toEqual([
      ["{", "bracket"],
      ['"id"', "propertyName"],
      ["12", "number"],
      ['"ok"', "propertyName"],
      ["true", "atom"],
      ['"tag"', "propertyName"],
      ['"a\\"b"', "string"],
      ['"n"', "propertyName"],
      ["null", "atom"],
      ['"xs"', "propertyName"],
      ["[", "bracket"],
      ["-1.5e3", "number"],
      ["]", "bracket"],
      ["}", "bracket"],
    ]);
    // A line that breaks off mid-string still ends at the line end; the next line starts clean.
    expect(tokens('{"a": "open', jsonLineToken).slice(-1)[0]).toEqual(['"open', "string"]);
    expect(tokens('{"b": 2}', jsonLineToken)[1]).toEqual(['"b"', "propertyName"]);
  });

  it("colours Nim keywords, types, strings, numbers and comments", () => {
    expect(tokens('proc add(a: int): int = a + 0x1F # sum "x"', nimToken)).toEqual([
      ["proc", "keyword"],
      ["int", "typeName"],
      ["int", "typeName"],
      ["0x1F", "number"],
      ['# sum "x"', "comment"],
    ]);
    expect(tokens('let s = "a\\"b"', nimToken)).toEqual([
      ["let", "keyword"],
      ['"a\\"b"', "string"],
    ]);
  });
});
