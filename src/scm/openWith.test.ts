import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
import { fileApps, listPatch, openFileWith } from "./openWith";
import { addApp, moveApp, PRESETS, readOpenIn, removeApp } from "../settings/openIn";

describe("GIT-014 the apps a file opens in", () => {
  it("lists the saved apps in the user's order and leaves the file manager to its own item", () => {
    expect(fileApps(null).map((a) => a.label)).toEqual(["Open in Visual Studio Code"]);
    const saved = { openInApps: [{ id: "zed", name: "Zed", command: "zed" }, { id: "explorer", name: "File Explorer", command: "explorer" }, { name: "My editor", command: "ed -f" }] };
    expect(fileApps(saved)).toEqual([
      { id: "zed", label: "Open in Zed", command: "zed" },
      { id: "custom:ed -f", label: "Open in My editor", command: "ed -f" },
    ]);
  });

  it("edits to the list from the menu give the patch the settings page would write", () => {
    const start = readOpenIn({});
    const cursor = PRESETS.find((p) => p.id === "cursor")!;
    const next = moveApp(addApp(start, cursor), "cursor", -1);
    expect(listPatch(next)).toEqual({ openInApps: next });
    expect(fileApps(listPatch(next)).map((a) => a.id)).toEqual(["cursor", "vscode"]);
    expect(fileApps(listPatch(removeApp(next, "vscode"))).map((a) => a.id)).toEqual(["cursor"]);
  });

  it("asks the back end to open the file by worktree, relative path and command", async () => {
    invoke.mockResolvedValueOnce(undefined);
    await openFileWith("C:/w", "src/a.ts", "code");
    expect(invoke).toHaveBeenCalledWith("scm_open_with", { worktree: "C:/w", path: "src/a.ts", command: "code" });
    invoke.mockRejectedValueOnce("zed was not found");
    await expect(openFileWith("C:/w", "a", "zed")).rejects.toBe("zed was not found");
  });
});
