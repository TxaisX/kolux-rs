// SAFE-004 box 1: the real PlanSheet function with its state kept by shallow-react.ts. The disabling
// decision is the real canRequest() inside the sheet.
import { expect, test, vi } from "vitest";
import PlanSheet from "../PlanSheet";
import type { PlanDraft } from "../planReview";
import { startFeedback } from "../planReview";
import { find, mount, textOf } from "../../settings/__cards__/shallow-react";

vi.mock("react", async (orig) => {
  const patched = (await import("../../settings/__cards__/shallow-react")).patchReact(await orig<object>());
  const useMemo = <T>(f: () => T) => f();
  return { ...patched, useMemo, default: { ...(patched as { default: object }).default, useMemo } };
});
vi.mock("../../editor/PreviewPane", () => ({ renderMarkdown: (md: string) => md }));

const sheet = (draft: PlanDraft) => {
  const tree = mount(PlanSheet, { title: "repo", plan: "# Plan\n\nDo it.", draft, onDraft: () => {}, onApprove: () => {}, onRequest: () => {}, onClose: () => {} }).render();
  return {
    request: find(tree, (e) => e.type === "button" && textOf(e).startsWith("Request changes")),
    approve: find(tree, (e) => e.type === "button" && textOf(e) === "Approve"),
  };
};

test("box 1: no comments and an empty note -> Request changes is disabled (a blank note counts as empty)", () => {
  const empty = sheet({ comments: [], note: "" });
  expect(empty.request.props.disabled).toBe(true);
  expect(textOf(empty.request)).toBe("Request changes");
  expect(empty.approve.props.disabled).toBe(false);
  expect(sheet({ comments: [], note: " \n\t " }).request.props.disabled).toBe(true);
  // the contrast: a note, or a comment, turns it on
  expect(sheet({ comments: [], note: "tighten step 2" }).request.props.disabled).toBe(false);
  const withComment = sheet({ comments: [{ id: "c", start: 1, end: 1, quote: "# Plan", text: "why?" }], note: "" });
  expect(withComment.request.props.disabled).toBe(false);
  expect(textOf(withComment.request)).toBe("Request changes (1)");
});

// SAFE-004 box 3: Request changes dismisses the plan prompt, then waits for the pane to leave the ask.
// A pane whose status never updates (no new reading arrives while it still reads as asking) gets the
// feedback anyway after about 3 seconds; a pane that had already left the prompt gets it at once.
const fakeClock = () => {
  let now = 0;
  return { now: () => now, tick: async (ms: number) => void (now += ms) };
};

test("box 3: a pane whose status never updates gets the feedback after about 3 seconds, not never and not at once", async () => {
  const clock = fakeClock();
  let typedAt = -1;
  const log: string[] = [];
  const job = startFeedback("tighten step 2", {
    deny: async () => (log.push("no"), true),
    asking: () => true, // the pane still reads as plan-approval...
    reads: () => 7, // ...and no new status reading ever arrives
    type: async (t) => void (log.push(`type:${t}`), (typedAt = clock.now())),
    enter: async () => void log.push(`enter@${clock.now()}`),
    alive: () => true,
    wait: async (ms) => void (log.push(`wait:${ms}`), await clock.tick(ms)),
  });
  expect(await job.done).toEqual({ outcome: "sent", answered: true, typed: true });
  expect(typedAt).toBe(3000); // 30 waits of 100 ms, then the message: not instantly, and not never
  expect(log.filter((l) => l === "wait:100")).toHaveLength(30);
  expect(log).toContain("type:tighten step 2");
  expect(log[log.length - 1]).toBe("enter@3300"); // then Enter after the 300 ms check
});

test("box 3: a pane that had already left the plan prompt gets the feedback straight away", async () => {
  const clock = fakeClock();
  let typedAt = -1;
  const log: string[] = [];
  const job = startFeedback("keep it short", {
    deny: async () => true,
    asking: () => false, // it left the prompt before the deny was answered
    reads: () => 7,
    type: async (t) => void (log.push(`type:${t}`), (typedAt = clock.now())),
    enter: async () => void log.push(`enter@${clock.now()}`),
    alive: () => true,
    wait: async (ms) => void (log.push(`wait:${ms}`), await clock.tick(ms)),
  });
  expect(await job.done).toEqual({ outcome: "sent", answered: true, typed: true });
  expect(typedAt).toBe(0); // no 3-second wait
  expect(log).toEqual(["type:keep it short", "wait:300", "enter@300"]);
});

test("box 3: a pane that keeps asking while fresh readings keep arriving types nothing (the fallback is for a stuck status alone)", async () => {
  const clock = fakeClock();
  let reads = 0;
  const job = startFeedback("x", {
    deny: async () => true,
    asking: () => true,
    reads: () => reads, // every wait brings a new reading that still says asking
    type: async () => {
      throw new Error("the message was typed into a pane that was still asking");
    },
    enter: async () => {
      throw new Error("Enter was pressed into a pane that was still asking");
    },
    alive: () => true,
    wait: async (ms) => void (reads++, await clock.tick(ms)),
  });
  expect((await job.done).outcome).toBe("still-asking");
});
