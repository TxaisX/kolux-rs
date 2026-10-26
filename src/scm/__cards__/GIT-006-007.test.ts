// GIT-006 and GIT-007 acceptance: the main button and the remote menu read the statuses a REAL git repository produced.
// evidence/cards-GIT-states.json is written by src-tauri/tests/cards_11.rs (scm::status after each real step, local bare origin);
// the labels come from the real nextStep / remoteItems.
import { expect, test } from "vitest";
import fixture from "../../../evidence/cards-GIT-states.json";
import { emptyStatus, nextStep, remoteItems, type Status } from "../model";

const states = fixture as unknown as Record<string, Record<string, Status>>;
const at = (key: string, step: string): Status => ({ ...emptyStatus, ...states[key][step] });

test("GIT-006 box 1: the label matches each step of a new branch: edit, stage, commit, publish, create pull request", () => {
  const w = states.git006;
  expect(w.edited.changed.length).toBe(1);
  expect(w.edited.upstream).toBeNull();
  expect(nextStep(at("git006", "edited"), "").label).toBe("Stage all");
  expect(nextStep(at("git006", "staged"), "")).toMatchObject({ label: "Commit", reason: "Write a message first" });
  expect(nextStep(at("git006", "staged"), "Extend seed")).toMatchObject({ label: "Commit", action: "commit", reason: null });
  expect(nextStep(at("git006", "committed"), "")).toMatchObject({ label: "Publish branch", action: "publish", reason: null });
  expect(nextStep(at("git006", "published"), "")).toMatchObject({ label: "Create pull request", action: "pr", reason: null });
});

test("GIT-006 box 2: after a rebase onto a moved base, force push with lease is offered, not pull or sync", () => {
  const rebased = at("git006", "rebased");
  expect(rebased.rewritten).toBe(true);
  expect(rebased.ahead).toBeGreaterThan(0);
  expect(rebased.behind).toBeGreaterThan(0);
  expect(nextStep(rebased, "")).toMatchObject({ label: "Force push with lease", action: "force", reason: null });
  expect(nextStep(rebased, "").label).not.toMatch(/^(Pull|Sync)/);
  expect(nextStep(at("git006", "forced"), "").label).toBe("Create pull request");
});

test("GIT-007 box 1: two local commits make the menu offer to push 2 commits; after the push the counts are zero", () => {
  const item = (s: Status) => Object.fromEntries(remoteItems(s).map((i) => [i.id, i])).push;
  expect(at("git007", "two").ahead).toBe(2);
  expect(item(at("git007", "two"))).toMatchObject({ label: "Push 2 commits", reason: null });
  const zero = at("git007", "zero");
  expect([zero.ahead, zero.behind]).toEqual([0, 0]);
  expect(item(zero)).toMatchObject({ label: "Push", reason: "Nothing to push" });
});
