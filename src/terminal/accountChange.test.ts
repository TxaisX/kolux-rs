import { describe, expect, it } from "vitest";
import { accountLabel, accountPrompt } from "./accountChange";

const accounts = [
  { id: "a1", email: "a@x.com" },
  { id: "b2", email: "b@x.com" },
  { id: "c3", email: "b@x.com" }, // ACCT-064: the same label as b2, still a different account
];
const codex = (account: string | null | undefined) => ({ agent: "codex", account });

describe("accountPrompt (ACCT-023, ACCT-064)", () => {
  it("asks a running Codex pane whose account is not the active one, by id", () => {
    expect(accountPrompt(codex("a1"), true, "b2", accounts, undefined)).toEqual({ kind: "changed", from: "a@x.com", to: "b@x.com" });
    expect(accountPrompt(codex("b2"), true, "c3", accounts, undefined)).toEqual({ kind: "changed", from: "b@x.com", to: "b@x.com" });
    // Codex's own sign-in counts as an account to move from or to.
    expect(accountPrompt(codex(null), true, "a1", accounts, undefined)).toMatchObject({ from: "Codex's own sign-in" });
    expect(accountPrompt(codex("a1"), true, null, accounts, undefined)).toMatchObject({ to: "Codex's own sign-in" });
  });
  it("leaves alone panes that are not running Codex, were never tied to an account, or sit on the active one", () => {
    expect(accountPrompt({ agent: "shell", account: "a1" }, true, "b2", accounts, undefined)).toBeNull();
    expect(accountPrompt(codex("a1"), false, "b2", accounts, undefined)).toBeNull();
    expect(accountPrompt(codex(undefined), true, "b2", accounts, undefined)).toBeNull();
    expect(accountPrompt(codex("b2"), true, "b2", accounts, undefined)).toBeNull();
    expect(accountPrompt(codex(null), true, null, accounts, undefined)).toBeNull();
  });
  it("keeping dismisses for that change only; going back to the pane's account clears it", () => {
    expect(accountPrompt(codex("a1"), true, "b2", accounts, "b2")).toBeNull();
    expect(accountPrompt(codex("a1"), true, "c3", accounts, "b2")?.kind).toBe("changed");
    expect(accountPrompt(codex("a1"), true, "a1", accounts, "b2")).toBeNull();
    expect(accountPrompt(codex("a1"), true, null, accounts, null)).toBeNull();
  });
  it("a pane whose account was removed needs a new one, kept or not", () => {
    expect(accountPrompt(codex("gone"), true, "b2", accounts, "b2")).toEqual({ kind: "removed", to: "b@x.com" });
    expect(accountPrompt(codex("gone"), true, null, accounts, undefined)).toEqual({ kind: "removed", to: null });
  });
  it("labels an account by email, else by a short id", () => {
    expect(accountLabel("a1", accounts)).toBe("a@x.com");
    expect(accountLabel("0123456789abcdef", [{ id: "0123456789abcdef", email: null }])).toBe("account 01234567");
  });
});
