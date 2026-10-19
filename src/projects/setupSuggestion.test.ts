import { describe, expect, it } from "vitest";
import { cardView, skippedLine } from "./setupSuggestion";

describe("PROJ-035 cardView", () => {
  it("offers the declared package manager's install command", () => {
    const v = cardView({ kind: "install", command: "pnpm install", manager: "pnpm" }, "api")!;
    expect(v.title).toBe("Run pnpm install for new workspaces?");
    expect(v.saveFrom).toBe("install");
    expect(v.script).toBe("pnpm install");
    expect(v.retry).toBe(false);
  });

  it("offers another tool's setup and lists the fields it left out", () => {
    const v = cardView({ kind: "import", file: "conductor.json", setup: "npm ci", skipped: ["env", "scripts.run"] }, "api")!;
    expect(v.saveFrom).toBe("conductor.json");
    expect(v.skipped).toEqual(["env", "scripts.run"]);
    expect(skippedLine(v.skipped)).toBe("Not supported, so left out: env, scripts.run.");
    expect(skippedLine([])).toBeNull();
  });

  it("shows an error with Retry and nothing to save, and no card when there is nothing to suggest", () => {
    const v = cardView({ kind: "error", message: "kolux.yaml could not be read: x" }, "api")!;
    expect(v.retry).toBe(true);
    expect(v.saveFrom).toBeUndefined();
    expect(cardView({ kind: "none" }, "api")).toBeNull();
  });
});
