import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
const saveAll = vi.fn();
vi.mock("./settings/useSettings", () => ({ saveAll: () => saveAll() }));

const { savePoint, watchDrafts, quitQuestion } = await import("./lifecycle");

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined);
  saveAll.mockReset().mockResolvedValue(true);
  watchDrafts(() => []);
});

describe("a restart, update or reload waits for a durable save point (APP-011)", () => {
  it("saves the settings drafts, then the store, and goes ahead", async () => {
    await expect(savePoint()).resolves.toBeUndefined();
    expect(saveAll).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("save_point");
  });
  it("is refused while an editor tab holds unsaved text, and nothing is saved or torn down", async () => {
    watchDrafts(() => ["notes.md", "main.rs"]);
    await expect(savePoint()).rejects.toThrow("notes.md and main.rs");
    expect(saveAll).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("is refused when a settings field could not be saved", async () => {
    saveAll.mockResolvedValue(false);
    await expect(savePoint()).rejects.toThrow(/could not be saved/);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("is refused when the store cannot write its save point, with the reason", async () => {
    invoke.mockRejectedValue("Kolux could not save: Access is denied. (os error 5)");
    await expect(savePoint()).rejects.toThrow("Access is denied");
  });
});

describe("closing the window asks first when work could be lost (APP-006)", () => {
  it("asks nothing when no program runs and no tab is unsaved", () => {
    expect(quitQuestion(0, [])).toBeNull();
  });
  it("names the running programs and the unsaved tabs", () => {
    expect(quitQuestion(1, [])?.body).toBe("A program is still running in 1 terminal. Quitting stops it.");
    const q = quitQuestion(2, ["notes.md"]);
    expect(q?.title).toBe("Quit Kolux?");
    expect(q?.body).toBe("Programs are still running in 2 terminals. Quitting stops them. notes.md has unsaved changes, which will be lost.");
  });
});
