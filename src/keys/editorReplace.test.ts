import { describe, expect, it } from "vitest";
import { actionById, defaultsFor } from "./actions";

// EDIT-005 (T-235-b): the replace chord is Mod+Alt+F on macOS (Cmd+Alt+F), Ctrl+H elsewhere.
describe("editor.replace default chord", () => {
  it("macOS has its own column, Windows and Linux keep Mod+H", () => {
    const a = actionById.get("editor.replace")!;
    expect(defaultsFor(a, "darwin")).toEqual(["Mod+Alt+F"]);
    expect(defaultsFor(a, "win32")).toEqual(["Mod+H"]);
    expect(defaultsFor(a, "linux")).toEqual(["Mod+H"]);
  });
});
