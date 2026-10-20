// SET-007: launch commands and advanced controls in the settings search.
import { expect, test } from "vitest";
import { MAX_SEARCH } from "./search";
import { searchAll, searchLaunch, type LaunchRow } from "./searchMore";

const rows: LaunchRow[] = [
  { id: "claude", name: "Claude", command: "C:\\tools\\claude-wrapper.cmd", args: "--model opus", env: "API_TOKEN=s3cret\nREGION=eu" },
  { id: "codex", name: "Codex" },
];

test("SET-007: a query finds an agent by its command, arguments or variable names", () => {
  expect(searchLaunch("wrapper", rows)).toEqual(["claude"]);
  expect(searchLaunch("--model opus", rows)).toEqual(["claude"]);
  expect(searchLaunch("region", rows)).toEqual(["claude"]);
  expect(searchLaunch("codex", rows)).toEqual(["codex"]);
  expect(searchLaunch("  ", rows)).toEqual([]);
});

test("SET-007: environment values are never searched", () => {
  expect(searchLaunch("s3cret", rows)).toEqual([]);
  expect(searchLaunch("eu", rows)).toEqual([]);
});

test("SET-007: a launch-command match shows the Agents section and opens its How it starts fold", () => {
  const hits = searchAll("wrapper", rows);
  expect(hits?.launch).toEqual(new Set(["claude"]));
  expect(hits?.open.has("how-it-starts")).toBe(true);
  expect(hits?.pages.find((p) => p.page === "agents")?.sections).toContain("agents");
});

test("SET-007: a query that matches only an advanced control brings it into view", () => {
  const hits = searchAll("environment variables", rows);
  expect(hits?.open.has("how-it-starts")).toBe(true);
  const proxy = searchAll("bypass", rows);
  expect(proxy?.open.has("proxy")).toBe(true);
  expect(proxy?.pages.some((p) => p.page === "general")).toBe(true);
});

test("SET-007: nothing searched is null, over-long text is refused untouched, a plain term opens nothing extra", () => {
  expect(searchAll("", rows)).toBeNull();
  const long = searchAll("x".repeat(MAX_SEARCH + 1), rows);
  expect(long?.refused).toBe(true);
  expect(long?.open.size).toBe(0);
  expect(searchAll("dark", rows)?.open.size).toBe(0);
});
