// APP-070: the app sends no usage data; Send feedback is a link the browser opens, not a request.
// scripts/privacy-audit.test.mjs checks the source for any network client the statement does not name.
import { expect, test } from "vitest";
import { FEEDBACK_REPO, feedbackUrl, OUTBOUND, URL_CAP } from "./privacy";

test("app070: Send feedback is a pre-filled new-issue address carrying the version, trimmed to fit", () => {
  const u = new URL(feedbackUrl("0.1.0", "Win32", "The pane froze\nafter a resize"));
  expect(u.origin + u.pathname).toBe(FEEDBACK_REPO);
  expect(u.searchParams.get("title")).toBe("[Feedback] The pane froze");
  expect(u.searchParams.get("body")).toContain("The pane froze\nafter a resize");
  expect(u.searchParams.get("body")).toContain("Kolux RS 0.1.0 on Win32");
  expect(new URL(feedbackUrl("0.1.0", "Win32")).searchParams.get("title")).toBe("[Feedback]");
  expect(new URL(feedbackUrl("0.1.0", "Win32", "y".repeat(200))).searchParams.get("title")).toHaveLength(80);
  const long = feedbackUrl("0.1.0", "Win32", "x".repeat(20000));
  expect(long.length).toBeLessThanOrEqual(URL_CAP);
  const body = new URL(long).searchParams.get("body") ?? "";
  expect(body).toContain("trimmed to fit in a browser address");
  expect(body).toContain("Kolux RS 0.1.0 on Win32");
  expect(OUTBOUND.map((o) => o.to).join(" ")).toMatch(/GitHub Releases/);
});

test("app037: the footer carries the extra lines the message box adds, and the trim keeps them", () => {
  const extra = "System: Windows 10.0.26200 (x86_64)\nGitHub: octo-fake";
  const body = new URL(feedbackUrl("0.1.0", "Win32", "hello", extra)).searchParams.get("body");
  expect(body).toBe("hello\n\n---\nKolux RS 0.1.0 on Win32\nSystem: Windows 10.0.26200 (x86_64)\nGitHub: octo-fake");
  const long = feedbackUrl("0.1.0", "Win32", "x".repeat(20000), extra);
  expect(long.length).toBeLessThanOrEqual(URL_CAP);
  expect(new URL(long).searchParams.get("body")).toContain("GitHub: octo-fake");
});
