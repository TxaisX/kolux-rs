import { describe, expect, it } from "vitest";
import { answerKeys, canAnswer, nextPrompt } from "./permissionAnswer";

describe("TERM-031 answer a permission prompt", () => {
  it("types the answer only while the prompt the user saw is still showing", () => {
    expect(canAnswer("claude", "permission", 1, 1)).toBe(true);
    // the agent moved on: the hook left "permission"
    expect(canAnswer("claude", "working", 1, 1)).toBe(false);
    // a new prompt replaced the one the control was drawn for
    expect(canAnswer("claude", "permission", 1, 2)).toBe(false);
  });

  it("never lands in a plain shell", () => {
    expect(canAnswer("shell", "permission", 1, 1)).toBe(false);
    expect(answerKeys("shell", "approve")).toBeNull();
  });

  it("counts prompts on each entry into the permission state", () => {
    let n = 0;
    n = nextPrompt(n, undefined, "permission");
    expect(n).toBe(1);
    n = nextPrompt(n, "permission", "permission");
    expect(n).toBe(1);
    n = nextPrompt(n, "permission", "working");
    n = nextPrompt(n, "working", "permission");
    expect(n).toBe(2);
  });

  it("maps approve/deny to each program's keys", () => {
    expect(answerKeys("claude", "approve")).toBe("\r");
    expect(answerKeys("claude", "deny")).toBe("\x1b");
    expect(answerKeys("codex", "approve")).toBe("y");
    expect(answerKeys("codex", "deny")).toBe("n");
  });
});
