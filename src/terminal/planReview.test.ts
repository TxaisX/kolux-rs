import { marked } from "marked";
import { expect, test, vi } from "vitest";
import { canRequest, feedbackMessage, OPENING, planSections, showsReview } from "./planReview";

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
