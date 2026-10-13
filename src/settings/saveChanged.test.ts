import { describe, expect, it } from "vitest";
import { settingsDiff } from "./saveChanged";

describe("settingsDiff (T-347)", () => {
  it("sends only the keys that changed and names the ones cleared", () => {
    const prev = { uiLook: "classic", quietMinutes: 5, lineups: { a: [1] }, gone: true };
    const next = { uiLook: "new", quietMinutes: 5, lineups: { a: [1] }, cleared: undefined, added: { x: 1 } };
    expect(settingsDiff(prev, next)).toEqual({ set: { uiLook: "new", added: { x: 1 } }, remove: ["gone"] });
  });
  it("leaves out a key the window never had, such as a link Kolux saved meanwhile", () => {
    const { set, remove } = settingsDiff({ theme: "a" }, { theme: "b" });
    expect(set).toEqual({ theme: "b" });
    expect(remove).toEqual([]);
    expect("scmLinkedPrs" in set).toBe(false);
  });
  it("sends a key set to undefined as a removal", () => {
    expect(settingsDiff({ a: 1, b: 2 }, { a: 1, b: undefined })).toEqual({ set: {}, remove: ["b"] });
  });
});
