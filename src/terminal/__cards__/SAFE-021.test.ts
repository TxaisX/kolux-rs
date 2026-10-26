// SAFE-021 terminal half. The real link scan and click planner run on made-up host paths (strings only); the
// refusal itself is Rust (src-tauri/tests/cards_10.rs safe021_*), this proves what text reaches it.
import { expect, test } from "vitest";
import { allowed, clickTarget, findLinks, linkFor, resolvePath } from "../links";

const ctrl = { ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
const UNC = "\\\\kolux-cards.invalid\\share\\x.txt";

test("SAFE-021 b1: a share path or a file URL naming a host reaches the opener as a double-backslash path", () => {
  for (const row of [`see ${UNC} now`, "see file://kolux-cards.invalid/share/x.txt now"]) {
    const [f] = findLinks(row);
    expect(f.kind).toBe("file");
    expect(f.target).toBe(UNC);
    expect(allowed(f)).toBe(true);
    expect(clickTarget(f, ctrl, false, false)).toBe("file");
    expect(resolvePath(f.target, "C:\\w")).toBe(UNC);
  }
  // an OSC 8 link written as a host file URL is the same link
  expect(linkFor("file://kolux-cards.invalid/share/x.txt")?.target).toBe(UNC);
});

test("SAFE-021 b1: a double-slash path in terminal output reaches the opener as a one-slash rooted path, which Rust refuses as not a full path", () => {
  const found = findLinks("see //kolux-cards.invalid/share/x.txt now");
  expect(found.map((f) => f.target)).toEqual(["/kolux-cards.invalid/share/x.txt"]);
  expect(resolvePath(found[0].target, "C:\\w")).toBe("/kolux-cards.invalid/share/x.txt");
});
