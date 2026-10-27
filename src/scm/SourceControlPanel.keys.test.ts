// Row 838: the Source Control list gives each group (Conflicts, Staged, Changes, Untracked) a key, so React never warns.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";
import SourceControlPanel from "./SourceControlPanel";
import type { Status } from "./model";

const status: Status = {
  branch: "main", upstream: null, ahead: 0, behind: 0, rewritten: false, base: null, head: null,
  staged: [{ path: "a.ts", status: "M", from: null }],
  changed: [{ path: "b.ts", status: "M", from: null }],
  untracked: [],
  conflicts: [{ path: "c.ts", status: "UU", from: null }],
  operation: "merge", resolved: [],
};

test("the Source Control groups render with no React key warning", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const props = { dir: "C:/repo", draft: "", onDraft: () => {}, onClose: () => {}, pinnedBase: null, againstUpstream: false, onAgainstUpstream: () => {}, agents: [], onHand: () => {}, initialStatus: status };
  const html = renderToString(createElement(SourceControlPanel, props as never));
  expect(html).toContain('data-section="Conflicts"');
  expect(html).toContain('data-section="Staged"');
  expect(html).toContain('data-section="Changes"');
  expect(error.mock.calls.map((c) => String(c[0]))).toEqual([]);
  error.mockRestore();
});
