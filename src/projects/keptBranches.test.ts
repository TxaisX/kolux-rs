// After-list row 129: the kept-branch prompt says that unpushed commits go with the branch.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import KeptBranches, { UNPUSHED_NOTE } from "./KeptBranches";

const noop = () => {};
const item = (branch: string) => ({ projectId: "p1", branch, commit: "0123456789abcdef0123456789abcdef01234567" });

describe("KeptBranches prompt", () => {
  it("the one-branch notice warns that commits never pushed or merged are deleted with the branch", () => {
    const html = renderToStaticMarkup(createElement(KeptBranches, { items: [item("login")], onChange: noop, onSay: noop }));
    expect(html).toContain(UNPUSHED_NOTE);
    expect(UNPUSHED_NOTE).toMatch(/never pushed or merged/);
  });

  it("the review list for several branches carries the same warning", () => {
    const html = renderToStaticMarkup(createElement(KeptBranches, { items: [item("a"), item("b")], onChange: noop, onSay: noop }));
    expect(html).toContain(UNPUSHED_NOTE);
  });
});
