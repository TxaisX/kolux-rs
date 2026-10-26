// SAFE-001 acceptance, the window half. The decision is the real showsReview(); the statuses it is given
// are the ones the hook layer produces (src-tauri/tests/cards_10.rs safe001_box1 / box2 prove the payloads).
// MIRROR App.tsx:3287 hands the pane's hook state and turn (tool, plan) to showsReview for the header button.
import { expect, test } from "vitest";
import { showsReview } from "../planReview";

const plan = "# Plan\n\n1. Read the code";

test("box 1: Claude asks to leave plan mode -> the review button shows; approved in the terminal instead -> it goes away", () => {
  // either hook event on its own: PreToolUse reads as waiting, PermissionRequest as permission
  expect(showsReview("waiting", { tool: "ExitPlanMode", plan })).toBe(true);
  expect(showsReview("permission", { tool: "ExitPlanMode", plan })).toBe(true);
  // approved at the prompt: the pane is working again and the status no longer carries the plan
  expect(showsReview("working", { tool: "ExitPlanMode", plan })).toBe(false);
  expect(showsReview("working", { tool: "ExitPlanMode" })).toBe(false);
  expect(showsReview("done", undefined)).toBe(false);
});

test("box 2: a shell-command permission never shows the review button", () => {
  expect(showsReview("permission", { tool: "Bash" })).toBe(false);
  expect(showsReview("permission", { tool: "Bash", plan })).toBe(false);
  expect(showsReview("permission", { tool: "ExitPlanMode", plan: "   " })).toBe(false);
});
