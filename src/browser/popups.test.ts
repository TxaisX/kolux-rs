import { describe, expect, it } from "vitest";
import { BLOCKED_SHOW_MS, blockedAgain, blockedLabel } from "./popups";

describe("T-272-c popups blocked note", () => {
  it("shows one refusal, then counts the ones that follow while it shows", () => {
    let b = blockedAgain(null, 1000);
    expect(blockedLabel(b, 1000)).toBe("Popup blocked");
    b = blockedAgain(b, 2000);
    b = blockedAgain(b, 3000);
    expect(blockedLabel(b, 3000)).toBe("3 popups blocked");
  });

  it("goes away a window after the last refusal and starts over after that", () => {
    const b = blockedAgain(blockedAgain(null, 0), 5000);
    expect(blockedLabel(b, 5000 + BLOCKED_SHOW_MS - 1)).toBe("2 popups blocked");
    expect(blockedLabel(b, 5000 + BLOCKED_SHOW_MS)).toBeNull();
    expect(blockedLabel(blockedAgain(b, 5000 + BLOCKED_SHOW_MS), 5000 + BLOCKED_SHOW_MS)).toBe("Popup blocked");
  });

  it("shows nothing when nothing was blocked", () => {
    expect(blockedLabel(null, 0)).toBeNull();
  });
});
