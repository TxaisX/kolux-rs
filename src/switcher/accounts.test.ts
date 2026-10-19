import { describe, expect, it, vi } from "vitest";
import { buttonText, cycleTarget, groupsOf, paletteRows, pickAccount, type ClaudeSwitchView, type CodexSwitchView } from "./accounts";

const claude = (over: Partial<ClaudeSwitchView> = {}): ClaudeSwitchView => ({
  accounts: [
    { id: "c1", email: "work@example.com", organization: "Acme", stale: false },
    { id: "c2", email: "me@example.com", organization: null, stale: false },
  ],
  active: "c1",
  signingIn: null,
  keyMode: false,
  upkeepLeftToClaude: true,
  ...over,
});
const codex = (over: Partial<CodexSwitchView> = {}): CodexSwitchView => ({
  accounts: [
    { id: "x1", email: "a@example.com", label: "Team", signInError: false },
    { id: "x2", email: "b@example.com", signInError: false },
  ],
  active: null,
  signingIn: null,
  missing: [],
  ...over,
});

// T-548 (OD-11): the quick switcher lists what Settings lists, one group per provider that has a managed account.
describe("groupsOf", () => {
  it("offers nothing while no provider has a managed account (the switcher stays hidden)", () => {
    expect(groupsOf(claude({ accounts: [], active: null }), codex({ accounts: [] }))).toEqual([]);
    expect(groupsOf(null, null)).toEqual([]);
  });

  it("lists System default first, then the accounts, and flags the active one (ACCT-016)", () => {
    const [g] = groupsOf(claude(), null);
    expect(g.provider).toBe("claude");
    expect(g.choices.map((c) => [c.id, c.label, c.active])).toEqual([
      [null, "System default", false],
      ["c1", "work@example.com", true],
      ["c2", "me@example.com", false],
    ]);
  });

  it("makes System default the active row when nothing is chosen, or the chosen id is no longer listed", () => {
    expect(groupsOf(claude({ active: null }), null)[0].choices.find((c) => c.active)?.id).toBeNull();
    expect(groupsOf(claude({ active: "gone" }), null)[0].choices.filter((c) => c.active).map((c) => c.id)).toEqual([null]);
  });

  it("tells the same email in two organisations apart by the organisation (ACCT-018)", () => {
    const [g] = groupsOf(
      claude({
        accounts: [
          { id: "c1", email: "me@example.com", organization: "Acme", stale: false },
          { id: "c2", email: "ME@example.com", organization: "Home", stale: false },
        ],
      }),
      null,
    );
    expect(g.choices.slice(1).map((c) => c.label)).toEqual(["me@example.com · Acme", "ME@example.com · Home"]);
  });

  it("shows a lapsed Claude sign-in only when Kolux is the one watching for it (ACCT-012)", () => {
    const stale = { accounts: [{ id: "c1", email: "a@example.com", organization: null, stale: true }], active: "c1" };
    expect(groupsOf(claude({ ...stale, upkeepLeftToClaude: true }), null)[0].choices[1].trouble).toBeNull();
    expect(groupsOf(claude({ ...stale, upkeepLeftToClaude: false }), null)[0].choices[1].trouble).toBe("Needs re-auth");
  });

  it("names a Codex account by its own name first, then its email, and numbers two unnamed ones on one email (ACCT-019)", () => {
    const [g] = groupsOf(
      null,
      codex({
        accounts: [
          { id: "x1", email: "a@example.com", label: "Team", signInError: false },
          { id: "x2", email: "b@example.com", signInError: false },
          { id: "x3", email: "b@example.com", signInError: false },
          { id: "x4", email: null, signInError: false },
        ],
      }),
    );
    expect(g.provider).toBe("codex");
    expect(g.choices.slice(1).map((c) => c.label)).toEqual(["Team", "b@example.com (1)", "b@example.com (2)", "ChatGPT account"]);
  });

  it("flags a Codex account whose sign-in is gone or failed, and holds the group while a sign-in runs", () => {
    const g = groupsOf(null, codex({ missing: ["x1"], accounts: [{ id: "x1", email: "a@example.com", signInError: false }, { id: "x2", email: "b@example.com", signInError: true }] }))[0];
    expect(g.choices.slice(1).map((c) => c.trouble)).toEqual(["Needs sign-in", "Needs re-auth"]);
    expect(g.busy).toBe(false);
    expect(groupsOf(null, codex({ signingIn: "browser" }))[0].busy).toBe(true);
    expect(groupsOf(claude({ signingIn: "c9" }), null)[0].busy).toBe(true);
  });

  it("says when the 1-year key wins for new Claude panes, and that running panes keep their account (ACCT-017)", () => {
    expect(groupsOf(claude({ keyMode: true }), null)[0].note).toMatch(/1-year key/);
    expect(groupsOf(claude(), null)[0].note).toBeNull();
  });
});

describe("buttonText", () => {
  it("reads the active account of each provider in the order they are listed", () => {
    expect(buttonText(groupsOf(claude(), codex()))).toBe("Claude work@example.com · Codex System default");
    expect(buttonText(groupsOf(null, codex({ active: "x1" })))).toBe("Codex Team");
    expect(buttonText([])).toBe("");
  });
});

describe("pickAccount", () => {
  it("calls the provider's own activate command with the id; System default sends null (ACCT-016)", async () => {
    const call = vi.fn(async () => undefined);
    const groups = groupsOf(claude(), codex({ active: "x1" }));
    await pickAccount(call, groups[0], "c2");
    await pickAccount(call, groups[0], null);
    await pickAccount(call, groups[1], null);
    expect(call.mock.calls).toEqual([
      ["claude_account_activate", { id: "c2" }],
      ["claude_account_activate", { id: null }],
      ["codex_account_activate", { id: null }],
    ]);
  });

  it("does nothing for the account already active, for an unlisted id, or while a sign-in runs", async () => {
    const call = vi.fn(async () => undefined);
    const [g] = groupsOf(claude(), null);
    expect(await pickAccount(call, g, "c1")).toBe(false);
    expect(await pickAccount(call, g, "nope")).toBe(false);
    expect(await pickAccount(call, groupsOf(claude({ signingIn: "c9" }), null)[0], "c2")).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });
});

describe("paletteRows", () => {
  it("offers one row per account that is not active already, in the Accounts section, and runs the pick", () => {
    const run = vi.fn();
    const rows = paletteRows(groupsOf(claude(), codex({ active: "x1" })), run);
    expect(rows.map((r) => [r.section, r.label])).toEqual([
      ["Accounts", "Switch Claude to System default"],
      ["Accounts", "Switch Claude to me@example.com"],
      ["Accounts", "Switch Codex to System default"],
      ["Accounts", "Switch Codex to b@example.com"],
    ]);
    expect(rows[0].hint).toBe("New Claude panes use it");
    rows[1].run();
    expect(run).toHaveBeenCalledWith("claude", "c2");
  });

  it("offers nothing while a sign-in runs for that provider", () => {
    expect(paletteRows(groupsOf(claude({ signingIn: "c9" }), null), vi.fn())).toEqual([]);
  });
});

describe("cycleTarget", () => {
  it("steps to the next account, wrapping through System default, for a one-key switch", () => {
    const [g] = groupsOf(claude(), null);
    expect(cycleTarget(g)).toBe("c2");
    expect(cycleTarget(groupsOf(claude({ active: "c2" }), null)[0])).toBeNull();
    expect(cycleTarget(groupsOf(claude({ active: null }), null)[0])).toBe("c1");
  });

  it("has nowhere to go with a single choice, or while busy", () => {
    expect(cycleTarget(groupsOf(claude({ signingIn: "c9" }), null)[0])).toBeUndefined();
  });
});
