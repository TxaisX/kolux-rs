import { describe, expect, it, vi } from "vitest";
import { codexOf } from "../usage/meter";
import { switcherLabel, activeOf, buttonText, cycleTarget, groupsOf, paletteRows, pickAccount, pickWithNotice, watchEscape, type ClaudeSwitchView, type CodexSwitchView } from "./accounts";

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

// FIX-1 (council d2 stand-in review, FIX-SOON 3): an active id that is no longer listed reads as System default
// in the pill, so the figures logic must read it the same way.
describe("activeOf", () => {
  it("passes a listed active id through and reads an unlisted one as the system default (null)", () => {
    expect(activeOf(claude(), codex({ active: "x2" }))).toEqual({ claude: "c1", codex: "x2" });
    expect(activeOf(claude({ active: "removed" }), codex({ active: "stale-id" }))).toEqual({ claude: null, codex: null });
  });

  it("reads null for a provider with no accounts or no view yet, even when it names an active id", () => {
    expect(activeOf(null, null)).toEqual({ claude: null, codex: null });
    expect(activeOf(claude({ accounts: [], active: "c1" }), codex({ accounts: [], active: "x1" }))).toEqual({ claude: null, codex: null });
  });

  it("agrees with the pill: a stale Codex id shows System default and a pane on the system default keeps the figures", () => {
    const view = codex({ active: "stale-id" });
    expect(buttonText(groupsOf(null, view))).toBe("Codex System default");
    const usage = { state: "ok" as const, fiveHour: null, weekly: null, resetCredits: null, plan: null, message: null };
    // raw id: a pane begun on the system default (null) lost its figures; normalised: it keeps them
    expect(codexOf("codex", null, view.active, usage)).toBeNull();
    expect(codexOf("codex", null, activeOf(null, view).codex, usage)).toBe(usage);
  });
});

// FIX-1 (FIX-SOON 1): the Tower reads the choice labels, not the ids.
describe("switcherLabel", () => {
  const groups = groupsOf(claude({ accounts: [{ id: "c-91", email: "work@example.com", organization: null, stale: false }], active: "c-91" }), codex({ accounts: [{ id: "7f3a9c", email: "a@example.com", label: "Team", signInError: false }, { id: "d41e02", email: "b@example.com", signInError: false }], active: "7f3a9c" }));
  it("maps an id to the label the switcher shows, per provider", () => {
    expect(switcherLabel(groups, "claude", "c-91")).toBe("work@example.com");
    expect(switcherLabel(groups, "codex", "7f3a9c")).toBe("Team");
    expect(switcherLabel(groups, "codex", "d41e02")).toBe("b@example.com");
  });
  it("falls back to the id for an account no longer listed, and does not cross providers", () => {
    expect(switcherLabel(groups, "codex", "gone")).toBe("gone");
    expect(switcherLabel(groups, "codex", "c-91")).toBe("c-91");
    expect(switcherLabel([], "claude", "c-91")).toBe("c-91");
  });
  // FIX-2 (AFTER 2): two accounts that read the same would look like one account on the Tower card.
  it("adds a short id suffix only to accounts whose label another account of that provider shares", () => {
    const twins = groupsOf(
      claude({ accounts: [{ id: "c-aa11", email: "work@example.com", organization: null, stale: false }, { id: "c-bb22", email: "work@example.com", organization: null, stale: false }, { id: "c-cc33", email: "me@example.com", organization: null, stale: false }], active: "c-aa11" }),
      codex({ accounts: [{ id: "x-dd44", email: "work@example.com", signInError: false }], active: "x-dd44" }),
    );
    const a = switcherLabel(twins, "claude", "c-aa11");
    const b = switcherLabel(twins, "claude", "c-bb22");
    expect(a).not.toBe(b);
    expect(a.startsWith("work@example.com")).toBe(true);
    expect(a).toContain("aa11");
    expect(b).toContain("bb22");
    expect(switcherLabel(twins, "claude", "c-cc33")).toBe("me@example.com");
    expect(switcherLabel(twins, "codex", "x-dd44")).toBe("work@example.com");
  });
  // FIX-3 (review AFTER 1): ids that share their last four characters still read differently.
  it("uses the shortest tail of the id that no same-name account shares, at least four characters", () => {
    const same = groupsOf(
      claude({ accounts: [{ id: "c-aa-9z9z", email: "work@example.com", organization: null, stale: false }, { id: "c-bb-9z9z", email: "work@example.com", organization: null, stale: false }, { id: "c-cc-1234", email: "work@example.com", organization: null, stale: false }], active: "c-aa-9z9z" }),
      null,
    );
    const a = switcherLabel(same, "claude", "c-aa-9z9z");
    const b = switcherLabel(same, "claude", "c-bb-9z9z");
    expect(a).toBe("work@example.com (a-9z9z)");
    expect(b).toBe("work@example.com (b-9z9z)");
    expect(switcherLabel(same, "claude", "c-cc-1234")).toBe("work@example.com (1234)");
  });
  // FIX-4 (review AFTER 1): one id is the tail of the other, so the short one cannot grow past itself.
  it("tells apart two accounts whose ids are 'ab12' and 'xab12' (one id ends the other)", () => {
    const tail = groupsOf(
      claude({ accounts: [{ id: "ab12", email: "work@example.com", organization: null, stale: false }, { id: "xab12", email: "work@example.com", organization: null, stale: false }], active: "ab12" }),
      null,
    );
    const a = switcherLabel(tail, "claude", "ab12");
    const b = switcherLabel(tail, "claude", "xab12");
    expect(a).toBe("work@example.com (ab12)");
    expect(b).toBe("work@example.com (xab12)");
    expect(a).not.toBe(b);
  });
  it("keeps a whole id that is shorter than four characters, and never reuses a label for two accounts", () => {
    const short = groupsOf(claude({ accounts: [{ id: "a1", email: "w@example.com", organization: null, stale: false }, { id: "b2", email: "w@example.com", organization: null, stale: false }], active: "a1" }), null);
    expect(switcherLabel(short, "claude", "a1")).toBe("w@example.com (a1)");
    expect(switcherLabel(short, "claude", "b2")).toBe("w@example.com (b2)");
  });
});

// FIX-1 (FIX-SOON 2): a failed shortcut or palette switch is told to the person, not dropped.
describe("pickWithNotice", () => {
  it("hands pick's error string to the notice, and says nothing when the switch worked", async () => {
    const notify = vi.fn();
    const failing = pickWithNotice(vi.fn(async () => "That Claude account is no longer listed."), notify);
    failing("claude", "c9");
    await new Promise((r) => setTimeout(r, 0));
    expect(notify).toHaveBeenCalledWith("That Claude account is no longer listed.");
    const pick = vi.fn(async () => null);
    const ok = pickWithNotice(pick, notify);
    ok("codex", "x2");
    await new Promise((r) => setTimeout(r, 0));
    expect(pick).toHaveBeenCalledWith("codex", "x2");
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

// FIX-1 (AFTER 1): Escape closes the menu wherever focus is, including when every row is disabled.
describe("watchEscape", () => {
  const key = (name: string) => Object.assign(new Event("keydown"), { key: name });
  it("closes on Escape only, and stops listening when released", () => {
    const target = new EventTarget();
    const close = vi.fn();
    const stop = watchEscape(target, close);
    target.dispatchEvent(key("a"));
    target.dispatchEvent(key("Enter"));
    expect(close).not.toHaveBeenCalled();
    target.dispatchEvent(key("Escape"));
    expect(close).toHaveBeenCalledTimes(1);
    stop();
    target.dispatchEvent(key("Escape"));
    expect(close).toHaveBeenCalledTimes(1);
  });
});

// FIX-2 (FIX-SOON 1): Escape interrupts an agent turn, so the Escape that closes the menu must not reach a focused pane.
describe("watchEscape (FIX-2: the menu keeps Escape to itself)", () => {
  const standIn = (name: string) => ({ key: name, stopPropagation: vi.fn(), preventDefault: vi.fn() });
  /** A target that keeps the handler and the options it was registered with. */
  const recording = () => {
    const calls: Array<{ type: string; fn: (e: unknown) => void; capture: unknown }> = [];
    return {
      calls,
      addEventListener: (type: string, fn: (e: unknown) => void, capture?: unknown) => void calls.push({ type, fn, capture }),
      removeEventListener: vi.fn(),
    };
  };

  it("listens in the capture phase, and releases the same registration", () => {
    const target = recording();
    const stop = watchEscape(target as never, vi.fn());
    expect(target.calls).toHaveLength(1);
    expect(target.calls[0]).toMatchObject({ type: "keydown", capture: { capture: true } });
    stop();
    expect(target.removeEventListener).toHaveBeenCalledWith("keydown", target.calls[0].fn, { capture: true });
  });

  it("closes the menu and stops the Escape there when the menu is open", () => {
    const target = recording();
    const close = vi.fn();
    watchEscape(target as never, close, () => true);
    const esc = standIn("Escape");
    target.calls[0].fn(esc);
    expect(close).toHaveBeenCalledTimes(1);
    expect(esc.stopPropagation).toHaveBeenCalledTimes(1);
    expect(esc.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("lets the Escape through untouched when the menu is shut", () => {
    const target = recording();
    const close = vi.fn();
    watchEscape(target as never, close, () => false);
    const esc = standIn("Escape");
    target.calls[0].fn(esc);
    expect(close).not.toHaveBeenCalled();
    expect(esc.stopPropagation).not.toHaveBeenCalled();
    expect(esc.preventDefault).not.toHaveBeenCalled();
  });

  it("leaves every other key alone even when the menu is open", () => {
    const target = recording();
    const close = vi.fn();
    watchEscape(target as never, close, () => true);
    for (const name of ["Enter", "a", "ArrowDown"]) {
      const ev = standIn(name);
      target.calls[0].fn(ev);
      expect(ev.stopPropagation).not.toHaveBeenCalled();
      expect(ev.preventDefault).not.toHaveBeenCalled();
    }
    expect(close).not.toHaveBeenCalled();
  });
});
