import { expect, test } from "vitest";
import { fontStack, rankFonts } from "./fonts";
import { appearanceVars, readAppearance, writeAppearance, uiFont, monoFont } from "../theme";

const LIST = ["Arial", "Cascadia Code", "Cascadia Mono", "Consolas", "Lucida Console", "Segoe UI"];

test("SET-018: names that begin with the text rank above names that only contain it", () => {
  expect(rankFonts(LIST, "co")).toEqual(["Consolas", "Cascadia Code", "Lucida Console"]);
  expect(rankFonts(LIST, "CAS")).toEqual(["Cascadia Code", "Cascadia Mono"]);
  expect(rankFonts(LIST, "")).toEqual(LIST);
});

test("SET-018: a safe fallback always follows the chosen family; empty means the default", () => {
  expect(fontStack("Comic Sans MS", uiFont)).toBe(`"Comic Sans MS", ${uiFont}`);
  expect(fontStack('  Evil"; } body { x', uiFont)).toBe(`"Evil  body  x", ${uiFont}`);
  expect(fontStack("  ", uiFont)).toBe(uiFont);
});

test("SET-018: app and editor fonts are kept; an empty editor font uses the terminal font", () => {
  const a = readAppearance({ appFont: "Segoe UI", editorFont: "" });
  expect(a.appFont).toBe("Segoe UI");
  expect(writeAppearance({}, a)).toMatchObject({ appFont: "Segoe UI", editorFont: "" });
  expect(appearanceVars(a)["--ui-font"]).toBe(`"Segoe UI", ${uiFont}`);
  expect(appearanceVars(a)["--editor-font"]).toBe(monoFont);
  expect(appearanceVars(readAppearance({ editorFont: "Consolas" }))["--editor-font"]).toBe(`"Consolas", ${monoFont}`);
  expect(readAppearance({ appFont: 42 }).appFont).toBe("");
});
