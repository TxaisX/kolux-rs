import { marked } from "marked";
import { expect, test, vi } from "vitest";
import { canRequest, draftKey, feedbackMessage, keepDraft, MAX_DRAFTS, OPENING, planSections, showsReview, stillPending, type PlanDraft } from "./planReview";

test("SAFE-002: blank lines split the plan into numbered sections; a fenced block with an empty line stays whole", () => {
  const plan = ["", "# Plan", "Read the code.", "", "", "Then fix it:", "```ts", "const a = 1;", "", "const b = 2;", "```", "", "Ship it.", "", ""].join("\n");
  const s = planSections(plan);
  expect(s.map((x) => [x.start, x.end])).toEqual([[2, 3], [6, 11], [13, 13]]);
  expect(s[1].text).toContain("const a = 1;\n\nconst b = 2;");
  expect(planSections("  \n\n ")).toEqual([]);
  expect(planSections("one\n~~~\n\n~~~\n\ntwo").map((x) => x.text)).toEqual(["one\n~~~\n\n~~~", "two"]);
});

test("SAFE-004: Request changes needs a comment or a real note; the message opens, lists comments by line range with a quote, then the note", () => {
  expect(canRequest([], "   ")).toBe(false);
  expect(canRequest([], " tighten it ")).toBe(true);
  const c = [
    { id: "a", start: 2, end: 3, quote: "# Plan Read the code.", text: "name the files" },
    { id: "b", start: 13, end: 13, quote: "Ship it.", text: "wait for review" },
  ];
  expect(canRequest(c, "")).toBe(true);
  const m = feedbackMessage(c, "  keep it short  ");
  expect(m.startsWith(OPENING)).toBe(true);
  expect(m.indexOf("Lines 2-3")).toBeLessThan(m.indexOf("Line 13"));
  expect(m).toContain("name the files");
  expect(m).toContain("> # Plan Read the code.");
  expect(m.endsWith("keep it short")).toBe(true);
  expect(feedbackMessage(c, "")).not.toContain("Overall");
});

test("SAFE-001: the review button shows only while Claude waits on its exit-plan step with a plan", () => {
  expect(showsReview("permission", { tool: "ExitPlanMode", plan: "do it" })).toBe(true);
  expect(showsReview("waiting", { tool: "ExitPlanMode", plan: "do it" })).toBe(true);
  expect(showsReview("permission", { tool: "Bash", plan: undefined })).toBe(false);
  expect(showsReview("permission", { tool: "ExitPlanMode", plan: undefined })).toBe(false);
  expect(showsReview("working", { tool: "ExitPlanMode", plan: "do it" })).toBe(false);
  expect(showsReview(undefined, undefined)).toBe(false);
});

test("SAFE-005: one draft per pane and exact plan text, at most 128 held, the oldest dropped first", () => {
  const d = (note: string): PlanDraft => ({ comments: [], note });
  expect(draftKey(3, "# Plan")).not.toBe(draftKey(3, "# Plan v2"));
  expect(draftKey(3, "# Plan")).not.toBe(draftKey(4, "# Plan"));
  let drafts: Record<string, PlanDraft> = {};
  for (let i = 0; i < MAX_DRAFTS; i++) drafts = keepDraft(drafts, draftKey(i, "p"), d(`n${i}`));
  expect(Object.keys(drafts)).toHaveLength(128);
  // Writing to a held draft keeps its place; a new one past the limit drops the oldest.
  drafts = keepDraft(drafts, draftKey(0, "p"), d("edited"));
  expect(Object.keys(drafts)).toHaveLength(128);
  drafts = keepDraft(drafts, draftKey(200, "p"), d("new"));
  expect(Object.keys(drafts)).toHaveLength(128);
  expect(drafts[draftKey(0, "p")]).toBeUndefined();
  expect(drafts[draftKey(1, "p")]?.note).toBe("n1");
  expect(drafts[draftKey(200, "p")]?.note).toBe("new");
});

test("SAFE-007: the sheet's plan is live only while the pane still waits on that exact plan", () => {
  const waiting = { tool: "ExitPlanMode", plan: "# Plan" };
  expect(stillPending("permission", waiting, "# Plan")).toBe(true);
  expect(stillPending("working", waiting, "# Plan")).toBe(false);
  expect(stillPending("permission", { tool: "ExitPlanMode", plan: "# Plan v2" }, "# Plan")).toBe(false);
  expect(stillPending("permission", { tool: "Bash" }, "# Plan")).toBe(false);
  expect(stillPending("waiting", undefined, "# Plan")).toBe(false);
});

test("SAFE-006, SAFE-007: the cut notice shows only for a cut plan; a closed prompt says so and disables both answers", async () => {
  vi.doMock("../editor/PreviewPane", () => ({ renderMarkdown: (md: string) => marked.parse(md, { async: false }) }));
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { default: PlanSheet } = await import("./PlanSheet");
  const props = { title: "orch-repo", plan: "# Plan", draft: { comments: [], note: "fine" }, onDraft: () => {}, onApprove: () => {}, onRequest: () => {}, onClose: () => {} };
  const plain = renderToString(createElement(PlanSheet, props));
  expect(plain).not.toContain("whole plan is in the terminal");
  expect(plain).not.toContain("plan prompt has closed");
  expect(plain).not.toMatch(/disabled=""[^>]*>(Approve|Request changes)/);
  expect(renderToString(createElement(PlanSheet, { ...props, cut: true }))).toContain("The whole plan is in the terminal.");
  const closed = renderToString(createElement(PlanSheet, { ...props, closed: true }));
  expect(closed).toContain("The plan prompt has closed");
  expect(closed).toMatch(/disabled=""[^>]*>Request changes<\/button>/);
  expect(closed).toMatch(/disabled=""[^>]*>Approve<\/button>/);
});

test("SAFE-002, SAFE-004: the sheet shows one block per section with its comments; Request changes waits for something to send", async () => {
  // No DOM here for the sanitiser, so the sheet gets marked's own output.
  vi.doMock("../editor/PreviewPane", () => ({ renderMarkdown: (md: string) => marked.parse(md, { async: false }) }));
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { default: PlanSheet } = await import("./PlanSheet");
  const props = { title: "orch-repo", plan: "# Plan\n\nRead it.\n\nShip it.", onDraft: () => {}, onApprove: () => {}, onRequest: () => {}, onClose: () => {} };
  const empty = renderToString(createElement(PlanSheet, { ...props, draft: { comments: [], note: "" } }));
  expect(empty.match(/class="plan-block"/g)?.length).toBe(3);
  expect(empty).toContain("<h1>Plan</h1>");
  expect(empty).toMatch(/<button[^>]*disabled=""[^>]*>Request changes<\/button>/);
  const one = renderToString(createElement(PlanSheet, { ...props, draft: { comments: [{ id: "c1", start: 3, end: 3, quote: "Read it.", text: "which files?" }], note: "" } }));
  expect(one).toMatch(/Line 3.*which files\?.*Remove/s);
  expect(one).toContain("Request changes (1)");
  expect(one).not.toMatch(/disabled=""[^>]*>Request changes/);
});
