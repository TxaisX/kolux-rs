import { expect, test } from "vitest";
import { CATALOGUE, findSchemes, importScheme, tidySchemes } from "./schemes";

test("SET-023: the catalogue has dark and light schemes, each with all 16 colours", () => {
  expect(CATALOGUE.some((s) => s.light) && CATALOGUE.some((s) => !s.light)).toBe(true);
  expect(CATALOGUE.find((s) => s.id === "tango-light")?.colours.background).toBe("#ffffff");
  for (const s of CATALOGUE) {
    expect(Object.keys(s.colours).length, s.id).toBeGreaterThanOrEqual(18);
    expect(new Set(CATALOGUE.map((c) => c.id)).size).toBe(CATALOGUE.length);
  }
});

test("SET-023: the catalogue narrows as the user types, ignoring case and spaces", () => {
  const all = findSchemes(CATALOGUE, "");
  expect(all.length).toBe(CATALOGUE.length);
  expect(findSchemes(CATALOGUE, "SOLAR").map((s) => s.id)).toEqual(["solarized-dark", "solarized-light"]);
  expect(findSchemes(CATALOGUE, "one half").map((s) => s.id)).toEqual(["one-half-dark", "one-half-light"]);
  expect(findSchemes(CATALOGUE, "zzz")).toEqual([]);
});

test("TERM-098: a pasted Windows Terminal scheme becomes a custom scheme (purple is magenta)", () => {
  const pasted = JSON.stringify({ name: " My Scheme ", background: "#101010", foreground: "#E0E0E0", purple: "#aa00aa", brightPurple: "#ff00ff", cursorColor: "#ffffff", selectionBackground: "#333", red: "nope" });
  const s = importScheme(pasted);
  expect(s).toMatchObject({ name: "My Scheme", background: "#101010", foreground: "#e0e0e0", magenta: "#aa00aa", brightMagenta: "#ff00ff", cursor: "#ffffff", selectionBackground: "#333" });
  expect(s).not.toHaveProperty("red");
  expect(() => importScheme("{not json")).toThrow(/scheme/i);
  expect(() => importScheme(JSON.stringify({ name: "x", background: "#000" })), "needs a text colour").toThrow(/foreground/i);
  expect(() => importScheme(JSON.stringify({ background: "#000", foreground: "#fff" })), "needs a name").toThrow(/name/i);
});

test("SET-023: custom schemes are tidied when loaded: bad entries dropped, names kept unique", () => {
  const saved = [{ name: "A", background: "#000000", foreground: "#ffffff" }, { name: "a", background: "#111111", foreground: "#eeeeee" }, { name: "B", background: "black", foreground: "#fff" }, "junk", null, { name: "C", background: "#222", foreground: "#ddd", blue: 5 }];
  const t = tidySchemes(saved);
  expect(t.map((s) => s.name)).toEqual(["A", "C"]);
  expect(t[1]).not.toHaveProperty("blue");
  expect(tidySchemes("nope")).toEqual([]);
});
