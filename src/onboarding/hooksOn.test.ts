// FIX-2 (review item 4): the status-hooks switch is read through one small helper that lives with the
// onboarding module, so stopCards no longer pulls the whole Agents settings page into its graph.
import { describe, expect, it } from "vitest";
import { HOOKS_FIELD as pageField, hooksOn as pageHooksOn } from "../settings/AgentsPage";
import { HOOKS_FIELD, hooksOn } from "./hooksOn";

describe("hooksOn (FIX-2)", () => {
  it("is on only when the saved switch is exactly true", () => {
    expect(hooksOn({ [HOOKS_FIELD]: true })).toBe(true);
    expect(hooksOn({ [HOOKS_FIELD]: false })).toBe(false);
    expect(hooksOn({})).toBe(false);
    expect(hooksOn({ [HOOKS_FIELD]: "true" })).toBe(false);
    expect(hooksOn({ [HOOKS_FIELD]: 1 })).toBe(false);
  });
  it("reads the same saved key as the Settings page, so the two cannot drift apart", () => {
    expect(HOOKS_FIELD).toBe(pageField);
    for (const s of [{ agentStatusHooks: true }, { agentStatusHooks: false }, {}, { agentStatusHooks: "yes" }]) {
      expect(hooksOn(s)).toBe(pageHooksOn(s));
    }
  });
});
