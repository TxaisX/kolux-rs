import { describe, expect, it } from "vitest";
import { answerKeys, buttonsShown, canAnswer, nextPrompt } from "./permissionAnswer";

describe("TERM-031 answer a permission prompt", () => {
  it("T-151-b: the buttons go after the first click or the first keystroke and stay gone until the next prompt", () => {
    let count = nextPrompt(0, undefined, "permission");
    let answered = 0;
    expect(buttonsShown("claude", "permission", answered, count, "Bash")).toBe(true);
    answered = count; // first click (or a key typed into the pane while the prompt shows)
    expect(buttonsShown("claude", "permission", answered, count, "Bash")).toBe(false); // the hook still says permission: hidden anyway
    expect(buttonsShown("claude", "working", answered, count, "Bash")).toBe(false);
    count = nextPrompt(count, "working", "permission"); // the next prompt
    expect(buttonsShown("claude", "permission", answered, count, "Bash")).toBe(true);
    expect(buttonsShown("shell", "permission", 0, count, "Bash")).toBe(false);
  });

  it("council D2: no buttons and no answer for a permission the hook did not name a tool for (a title or OSC guess)", () => {
    expect(buttonsShown("claude", "permission", 0, 1, undefined)).toBe(false);
    expect(buttonsShown("codex", "permission", 0, 1, "")).toBe(false);
    expect(canAnswer("claude", "permission", 1, 1, undefined)).toBe(false);
    expect(buttonsShown("claude", "permission", 0, 1, "Edit")).toBe(true);
    expect(canAnswer("claude", "permission", 1, 1, "Edit")).toBe(true);
  });

  it("types the answer only while the prompt the user saw is still showing", () => {
    expect(canAnswer("claude", "permission", 1, 1, "Bash")).toBe(true);
    // the agent moved on: the hook left "permission"
    expect(canAnswer("claude", "working", 1, 1, "Bash")).toBe(false);
    // a new prompt replaced the one the control was drawn for
    expect(canAnswer("claude", "permission", 1, 2, "Bash")).toBe(false);
  });

  it("never lands in a plain shell", () => {
    expect(canAnswer("shell", "permission", 1, 1, "Bash")).toBe(false);
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

  it("T-151-c: a third program gets no guessed y/n: no keys, no buttons, no answer", () => {
    expect(answerKeys("gemini", "approve")).toBeNull();
    expect(answerKeys("gemini", "deny")).toBeNull();
    expect(answerKeys("", "approve")).toBeNull();
    expect(buttonsShown("gemini", "permission", 0, 1, "Bash")).toBe(false);
    expect(canAnswer("gemini", "permission", 1, 1, "Bash")).toBe(false);
    expect(buttonsShown("codex", "permission", 0, 1, "Bash")).toBe(true);
  });
});
