import { expect, test } from "vitest";
import { isSubmitChord, MAX_SEARCH, narrowOptions, numberFromField, segmentViews } from "./pickers";

test("SET-036: a number field that is cleared goes back to its default; junk and out-of-range are refused", () => {
  expect(numberFromField("", 1000, 0, 100000)).toBe(1000);
  expect(numberFromField("   ", 1000, 0, 100000)).toBe(1000);
  expect(numberFromField("250", 1000, 0, 100000)).toBe(250);
  expect(numberFromField("0", 1000, 0, 100000)).toBe(0);
  expect(numberFromField("abc", 1000, 0, 100000)).toBeNull();
  expect(numberFromField("100001", 1000, 0, 100000)).toBeNull();
});

test("SET-036: a long option list narrows as the user types, ignoring case and accents", () => {
  const fonts = ["Cascadia Code", "Consolas", "Fira Code", "Ménlo", "JetBrains Mono"];
  const by = (q: string) => narrowOptions(fonts, q, (f) => f).items;
  expect(by("")).toEqual(fonts);
  expect(by("code")).toEqual(["Cascadia Code", "Fira Code"]);
  expect(by("MENLO")).toEqual(["Ménlo"]);
  expect(by("zzz")).toEqual([]);
});

test("SET-036: oversized search text is refused before any filtering", () => {
  let looked = 0;
  const big = "x".repeat(MAX_SEARCH + 1);
  const r = narrowOptions(["a", "b"], big, (o) => (looked++, o));
  expect(r.refused).toBe(true);
  expect(r.items).toEqual(["a", "b"]);
  expect(looked).toBe(0);
  expect(narrowOptions(["a"], "x".repeat(MAX_SEARCH), (o) => o).refused).toBe(false);
});

test("SET-036: a segmented choice that is unavailable is greyed with its reason and cannot be picked", () => {
  const v = segmentViews(
    [
      { value: "auto", label: "Auto" },
      { value: "gpu", label: "GPU", unavailable: "No graphics acceleration on this computer" },
    ],
    "gpu",
  );
  expect(v[0]).toMatchObject({ disabled: false, reason: null, selected: false });
  expect(v[1]).toMatchObject({ disabled: true, reason: "No graphics acceleration on this computer", selected: true });
});

test("SET-036: Ctrl or Cmd with Enter submits, and does nothing while an input method is composing", () => {
  expect(isSubmitChord({ key: "Enter", ctrlKey: true })).toBe(true);
  expect(isSubmitChord({ key: "Enter", metaKey: true })).toBe(true);
  expect(isSubmitChord({ key: "Enter" })).toBe(false);
  expect(isSubmitChord({ key: "Enter", ctrlKey: true, isComposing: true })).toBe(false);
  expect(isSubmitChord({ key: "Enter", metaKey: true, keyCode: 229 })).toBe(false);
});
