import { describe, expect, it } from "vitest";
import { itemOfTarget, PASTE_MAX, pasteLine, pastedWork, rowForNumber } from "./pasteWork";

describe("GIT-059 pasting an address to start work on it", () => {
  it("takes an issue or pull request address as an item lookup, on its own host", () => {
    expect(pastedWork("https://github.com/acme/app/issues/12")).toEqual({ kind: "item", target: { host: "github.com", repo: "acme/app", number: 12, kind: "issue" } });
    expect(pastedWork("  https://git.corp.example/acme/app/pull/3/files ")).toEqual({ kind: "item", target: { host: "git.corp.example", repo: "acme/app", number: 3, kind: "pull" } });
  });
  it("treats a number after a hash sign as a lookup and an ordinary name as none", () => {
    expect(pastedWork("#42")).toEqual({ kind: "number", number: 42 });
    for (const plain of ["fix-login", "my workspace", "42", "#", "#0", "# 4", "https://github.com/acme/app", "http://github.com/acme/app/issues/1", ""]) {
      expect(pastedWork(plain), plain).toBeNull();
    }
  });
  it("refuses oversized text and never looks it up, even when it holds an address", () => {
    const big = `https://github.com/acme/app/issues/1 ${"x".repeat(PASTE_MAX)}`;
    expect(pastedWork(big)).toMatchObject({ kind: "refused" });
    expect(pastedWork("a".repeat(PASTE_MAX + 1))).toMatchObject({ kind: "refused" });
    expect(pastedWork("a".repeat(PASTE_MAX))).toBeNull();
  });
  it("finds a number only when exactly one row on screen has it", () => {
    const rows = [
      { number: 5, repo: "acme/app", host: "github.com", kind: "issue" },
      { number: 6, repo: "acme/app", host: "github.com", kind: "pr" },
      { number: 6, repo: "acme/lib", host: "github.com", kind: "issue" },
    ];
    expect(rowForNumber(rows, 5)?.repo).toBe("acme/app");
    expect(rowForNumber(rows, 6), "two repositories have #6: not guessed").toBeNull();
    expect(rowForNumber(rows, 7)).toBeNull();
  });
  it("makes the create command's item from the address, with the address's own host", () => {
    expect(itemOfTarget({ host: "git.corp.example", repo: "acme/app", number: 3, kind: "pull" })).toEqual({ host: "git.corp.example", owner: "acme", repo: "app", kind: "pull", number: 3 });
    expect(itemOfTarget({ host: "github.com", repo: "acme/app", number: 12, kind: "issue" })).toEqual({ host: "github.com", owner: "acme", repo: "app", kind: "issue", number: 12 });
    expect(itemOfTarget({ host: "github.com", repo: "acme", number: 1, kind: "issue" })).toBeNull();
  });
  it("says what it found, with the title once it is read", () => {
    const t = { host: "github.com", repo: "acme/app", number: 12, kind: "issue" as const };
    expect(pasteLine(t, null)).toBe("Issue #12 in acme/app");
    expect(pasteLine({ ...t, kind: "pull" }, "Fix login")).toBe("Pull request #12 in acme/app: Fix login");
  });
});
