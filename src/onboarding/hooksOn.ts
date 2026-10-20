// FIX-2: the one place the onboarding module reads the agent status hooks switch. stopCards used to import
// `hooksOn` from the whole Agents settings page, which pulled that page into this module's graph. The key
// and the rule are the Settings page's (STAT-002, T-152-gate: off until the user turns it on; that choice is
// the recorded approval to write hooks); hooksOn.test.ts checks the two agree.
export const HOOKS_FIELD = "agentStatusHooks";
export const hooksOn = (s: Record<string, unknown>): boolean => s[HOOKS_FIELD] === true;
