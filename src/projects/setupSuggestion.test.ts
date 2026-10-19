import { describe, expect, it } from "vitest";
import { cardView, saveArgs, skippedLine } from "./setupSuggestion";

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

describe("FIX-1 the save carries the script the card showed", () => {
  it("hands back what was shown, so a changed file is refused rather than saved", () => {
    const v = cardView({ kind: "import", file: "conductor.json", setup: "npm ci", skipped: [] }, "api")!;
    expect(saveArgs("C:/api", v)).toEqual({ path: "C:/api", from: "conductor.json", shown: "npm ci" });
    const i = cardView({ kind: "install", command: "pnpm install", manager: "pnpm" }, "api")!;
    expect(saveArgs("C:/api", i)).toEqual({ path: "C:/api", from: "install", shown: "pnpm install" });
    expect(saveArgs("C:/api", cardView({ kind: "error", message: "x" }, "api")!)).toBeNull();
  });
});
