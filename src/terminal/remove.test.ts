import { describe, expect, it } from "vitest";
import { classify, readRemove, removePlan, removeQuestion } from "./remove";
import { askKey } from "../chrome/Ask";

describe("TERM-003 remove a started session", () => {
  it("classifies panes before deciding", () => {
    expect(classify({ agent: "shell", seats: [{}] }, false)).toBe("unstarted");
    expect(classify({ agent: "claude" }, false)).toBe("agent");
    expect(classify({ agent: "shell" }, true)).toBe("shell");
    expect(classify({ agent: "shell" }, false)).toBe("idle");
  });

  it("removes unstarted panes and idle shells without a prompt, asks for started sessions by default", () => {
    expect(removePlan({}, "unstarted")).toBe("remove");
    expect(removePlan({}, "idle")).toBe("remove");
    expect(removePlan({}, "agent")).toBe("ask");
    expect(removePlan({}, "shell")).toBe("ask");
  });

  it("with the default set to stop, removing a started session stops it without a dialog", () => {
    expect(readRemove({ removeStartedSession: "stop" })).toBe("stop");
    expect(removePlan({ removeStartedSession: "stop" }, "agent")).toBe("stop");
    expect(removePlan({ removeStartedSession: "stop" }, "unstarted")).toBe("remove");
    // "sleep" has no per-session sleep to land on yet: it reads as ask
    expect(readRemove({ removeStartedSession: "sleep" })).toBe("ask");
  });

  it("the question names the session; Enter pressed at once (Cancel focused, not Confirm) does not confirm", () => {
    expect(removeQuestion("claude 1", "agent")).toEqual({ title: "Stop “claude 1”?", body: "Its agent is still running. Removing the pane stops it." });
    expect(removeQuestion("shell", "shell").body).toMatch(/still running in this shell/);
    // VIEW-116's dialog gives Cancel focus on open; Enter there is "pass" (does what Cancel does), never confirms
    expect(askKey("Enter", false, true)).toBe("pass");
    expect(askKey("Enter", true, false)).toBe("block");
  });
});
