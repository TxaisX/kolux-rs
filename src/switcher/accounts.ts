// T-548 (OD-11): the quick account switcher. One list per provider that has a managed account,
// built from the same two views Settings reads (claude_accounts, codex_accounts), so the top bar
// and the palette can change which account NEW panes use without a visit to Settings. Panes that
// are already running keep the account they started on (ACCT-017). Pure: the component and the
// palette rows both read this file; the Rust commands are the existing activate ones.

export type Provider = "claude" | "codex";

/** What the switcher reads of the Claude accounts view (the rest of it is Settings' business). */
export type ClaudeSwitchView = {
  accounts: Array<{ id: string; email: string | null; organization: string | null; stale: boolean }>;
  active: string | null;
  signingIn: string | null;
  keyMode: boolean;
  upkeepLeftToClaude: boolean;
};
/** What it reads of the Codex accounts view. */
export type CodexSwitchView = {
  accounts: Array<{ id: string; email: string | null; label?: string; signInError: boolean }>;
  active: string | null;
  signingIn: string | null;
  missing: string[];
};

export type Choice = { id: string | null; label: string; active: boolean; trouble: string | null };
export type Group = { provider: Provider; name: string; choices: Choice[]; busy: boolean; note: string | null };

export const SYSTEM_DEFAULT = "System default";
const NAMES: Record<Provider, string> = { claude: "Claude", codex: "Codex" };
const COMMANDS: Record<Provider, string> = { claude: "claude_account_activate", codex: "codex_account_activate" };

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** The choices of one provider: System default first, then the managed accounts; an active id that
 *  is no longer listed reads as System default (the backend does the same). */
function choicesOf(rows: Array<{ id: string; label: string; trouble: string | null }>, active: string | null): Choice[] {
  const live = rows.some((r) => r.id === active) ? active : null;
  return [{ id: null, label: SYSTEM_DEFAULT, active: live === null, trouble: null }, ...rows.map((r) => ({ ...r, active: r.id === live }))];
}

function claudeGroup(v: ClaudeSwitchView): Group {
  const rows = v.accounts.map((a) => {
    // ACCT-018: one account is one email in one organisation, so the same email twice needs the organisation.
    const twice = v.accounts.some((b) => b.id !== a.id && same(b.email, a.email));
    const email = a.email ?? "Claude account";
    return { id: a.id, label: twice && a.organization ? `${email} · ${a.organization}` : email, trouble: a.stale && !v.upkeepLeftToClaude ? "Needs re-auth" : null };
  });
  return {
    provider: "claude",
    name: NAMES.claude,
    choices: choicesOf(rows, v.active),
    busy: v.signingIn !== null,
    note: v.keyMode ? "The 1-year key is connected, so new Claude panes use the key until it is disconnected." : null,
  };
}

function codexGroup(v: CodexSwitchView): Group {
  const unnamed = (email: string | null) => v.accounts.filter((b) => !b.label && !!email && same(b.email, email));
  const rows = v.accounts.map((a) => {
    const shared = !a.label ? unnamed(a.email) : [];
    const label = a.label || (a.email ? (shared.length > 1 ? `${a.email} (${shared.findIndex((b) => b.id === a.id) + 1})` : a.email) : "ChatGPT account");
    return { id: a.id, label, trouble: v.missing.includes(a.id) ? "Needs sign-in" : a.signInError ? "Needs re-auth" : null };
  });
  return { provider: "codex", name: NAMES.codex, choices: choicesOf(rows, v.active), busy: v.signingIn !== null, note: null };
}

/** One group per provider that has at least one managed account; with none the switcher stays hidden. */
export function groupsOf(claude: ClaudeSwitchView | null, codex: CodexSwitchView | null): Group[] {
  const out: Group[] = [];
  if (claude && claude.accounts.length > 0) out.push(claudeGroup(claude));
  if (codex && codex.accounts.length > 0) out.push(codexGroup(codex));
  return out;
}

/** The top-bar button: "Claude work@example.com · Codex Team". */
export function buttonText(groups: Group[]): string {
  return groups.map((g) => `${g.name} ${g.choices.find((c) => c.active)?.label ?? SYSTEM_DEFAULT}`).join(" · ");
}

/** Switches the account new panes of this provider use. Returns whether anything was asked: the
 *  account already in use, an unlisted one and a provider mid sign-in are left alone. */
export async function pickAccount(call: (command: string, args: { id: string | null }) => Promise<unknown>, group: Group, id: string | null): Promise<boolean> {
  const choice = group.choices.find((c) => c.id === id);
  if (!choice || choice.active || group.busy) return false;
  await call(COMMANDS[group.provider], { id });
  return true;
}

/** The palette rows (section Accounts): every account of every provider that is not in use already. */
export function paletteRows(groups: Group[], run: (provider: Provider, id: string | null) => void): Array<{ section: string; label: string; hint: string; run: () => void }> {
  return groups
    .filter((g) => !g.busy)
    .flatMap((g) => g.choices.filter((c) => !c.active).map((c) => ({ section: "Accounts", label: `Switch ${g.name} to ${c.label}`, hint: `New ${g.name} panes use it`, run: () => run(g.provider, c.id) })));
}

/** The account a one-key switch moves to: the next one down the list, wrapping to System default
 *  (null) and back; undefined when there is nowhere to go (one choice, or a sign-in running). */
export function cycleTarget(group: Group): string | null | undefined {
  if (group.busy || group.choices.length < 2) return undefined;
  const at = group.choices.findIndex((c) => c.active);
  return group.choices[(at + 1) % group.choices.length].id;
}
