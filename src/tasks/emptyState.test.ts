import { expect, test } from "vitest";
import { emptyReason } from "./emptyState";

const facts = { project: "web", remote: true, loaded: true, count: 0, query: "", page: 1 };

test("T-281 (GIT-045): an empty Tasks list says why", () => {
  expect(emptyReason({ ...facts, project: null })).toBe("Add a project to see its GitHub issues and pull requests.");
  expect(emptyReason({ ...facts, remote: false })).toContain("web has no GitHub remote");
  expect(emptyReason({ ...facts, loaded: false })).toBe("Loading…");
  expect(emptyReason({ ...facts, count: 3 })).toBeNull();
  expect(emptyReason({ ...facts, page: 3 })).toContain("past the last result");
  expect(emptyReason({ ...facts, query: " label:bug " })).toBe('Nothing in web matches "label:bug". Clear the search or pick another filter.');
  expect(emptyReason(facts)).toBe("Nothing in web is in this list. Pick another filter above.");
});
