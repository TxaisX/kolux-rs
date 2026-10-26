// after-list 499: Open file can use the Open in apps.
import { expect, test, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { openShortcutsFileIn, shortcutsFileApps } from "./shortcutsFileOpen";

test("the shortcuts file offers the saved Open in apps, VS Code before anything is saved, never the file manager", () => {
  expect(shortcutsFileApps(null)).toEqual([{ label: "Visual Studio Code", command: "code" }]);
  const s = { openInApps: [{ id: "explorer", name: "File Explorer", command: "explorer" }, { id: "zed", name: "Zed", command: "zed" }] };
  expect(shortcutsFileApps(s).map((a) => a.label)).toEqual(["Zed"]);
});

test("choosing an app sends its command with the open request", async () => {
  invoke.mockResolvedValue(undefined);
  await openShortcutsFileIn({ label: "Zed", command: "zed" });
  expect(invoke).toHaveBeenCalledWith("keybindings_show", { reveal: false, command: "zed" });
});
