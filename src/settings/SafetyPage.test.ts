import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { asksAtAll, ASK_FIELD, OFF_FIELD, offIds, ruleOn, SafetyView, savedState, switchAll, switchRule, type RuleInfo } from "./SafetyPage";

// The seven rules as protected_rules lists them (the Rust catalog test proves each example asks).
const RULES: RuleInfo[] = [
  { id: "stripe", name: "Stripe changes", samples: ["stripe refunds create --charge ch_1", "stripe customers delete cus_1"] },
  { id: "force-push", name: "Force-push to main", samples: ["git push --force origin main", "git push origin +main"] },
  { id: "db-drop", name: "Deleting database tables", samples: ["psql -c \"DROP TABLE users\"", "dropdb production"] },
  { id: "infra", name: "Infrastructure changes", samples: ["terraform apply -auto-approve", "pulumi destroy"] },
  { id: "prod-deploy", name: "Production deploys", samples: ["vercel --prod", "netlify deploy --prod"] },
  { id: "delete", name: "Deleting folders outside the workspace", samples: ["rm -rf ../other-project", "rm -rf ~"] },
  { id: "discard", name: "Throwing away uncommitted work", samples: ["git reset --hard", "git clean -fdx"] },
];
const view = (settings: Record<string, unknown>, rules: RuleInfo[] | null = RULES, error: string | null = null) => renderToString(createElement(SafetyView, { settings, rules, error, save: () => {} }));
const switchOf = (html: string, label: string) => html.match(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";

test("SAFE-015: the section explains itself, says only Claude Code is covered and reminds that the status hooks must be on", () => {
  const html = view({ agentStatusHooks: true });
  expect(html).toContain('data-section="protected"');
  expect(html).toContain("Protected actions");
  expect(html).toContain("Only Claude Code is covered");
  expect(html).toContain("agent status hooks");
  expect(html).not.toContain('role="alert"');
  // With the hooks switch off (its default) the reminder is a warning that points at Settings > Agents.
  const off = view({});
  expect(off).toContain('role="alert"');
  expect(off).toContain("Settings &gt; Agents");
});

test("SAFE-015: a master switch named Ask before protected actions, on by default, then one row per rule with its name, examples and a switch", () => {
  const html = view({});
  expect(switchOf(html, "Ask before protected actions")).toContain("checked");
  expect(html.indexOf("Ask before protected actions")).toBeLessThan(html.indexOf("Stripe changes"));
  for (const r of RULES) {
    expect(html, r.id).toContain(`data-rule="${r.id}"`);
    expect(switchOf(html, r.name), r.name).toContain("checked");
    for (const s of r.samples) expect(html, s).toContain(`<code>${s.replace(/"/g, "&quot;")}</code>`);
  }
  expect((html.match(/data-rule="/g) ?? []).length).toBe(7);
  expect(RULES.map((r) => r.name)).toEqual(["Stripe changes", "Force-push to main", "Deleting database tables", "Infrastructure changes", "Production deploys", "Deleting folders outside the workspace", "Throwing away uncommitted work"]);
});

test("SAFE-015: what is saved decides what is drawn: a rule in the off list is unchecked, the master switch off says nothing asks", () => {
  const html = view({ [OFF_FIELD]: ["force-push"], [ASK_FIELD]: false });
  expect(switchOf(html, "Force-push to main")).not.toContain("checked");
  expect(switchOf(html, "Stripe changes")).toContain("checked");
  expect(switchOf(html, "Ask before protected actions")).not.toContain("checked");
  expect(html).toContain("no rule asks");
  expect(html).toContain("data-master-off");
});

test("SAFE-015: the rule list is waiting, or could not be read, without hiding the master switch", () => {
  const wait = view({}, null);
  expect(wait).toContain("Reading the rules");
  expect(switchOf(wait, "Ask before protected actions")).toContain("switch");
  const bad = view({}, null, "no such command");
  expect(bad).toContain("The rules could not be listed:");
  expect(bad).toContain("no such command");
  expect(bad).not.toContain("Reading the rules");
});

test("SAFE-015: the patches the switches save are exactly what the Rust check reads (protectedAsk, protectedOff)", () => {
  expect(switchAll(false)).toEqual({ protectedAsk: false });
  expect(switchAll(true)).toEqual({ protectedAsk: true });
  // Force-push off, then on again (the acceptance flow), keeping another rule that was already off.
  let s: Record<string, unknown> = { [OFF_FIELD]: ["discard"] };
  s = { ...s, ...switchRule(s, "force-push", false) };
  expect(s[OFF_FIELD]).toEqual(["discard", "force-push"]);
  expect([ruleOn(s, "force-push"), ruleOn(s, "discard"), ruleOn(s, "stripe")]).toEqual([false, false, true]);
  s = { ...s, ...switchRule(s, "force-push", true) };
  expect(s[OFF_FIELD]).toEqual(["discard"]);
  // Switching the same rule off twice never lists it twice; an id this page does not draw is kept.
  expect(switchRule({ [OFF_FIELD]: ["custom-1", "stripe"] }, "stripe", false)[OFF_FIELD]).toEqual(["custom-1", "stripe"]);
  expect(switchRule({ [OFF_FIELD]: ["custom-1"] }, "stripe", true)[OFF_FIELD]).toEqual(["custom-1"]);
});

test("SAFE-015: a settings file that was never saved, or hand-edited badly, leaves every rule on", () => {
  expect([asksAtAll({}), asksAtAll({ [ASK_FIELD]: "no" }), asksAtAll({ [ASK_FIELD]: true }), asksAtAll({ [ASK_FIELD]: false })]).toEqual([true, true, true, false]);
  for (const bad of [undefined, null, "force-push", 7, {}, [1, null, {}]]) expect(offIds({ [OFF_FIELD]: bad }), String(bad)).toEqual([]);
  expect(offIds({ [OFF_FIELD]: ["a", 3, "b"] })).toEqual(["a", "b"]);
  expect(ruleOn({ [OFF_FIELD]: "stripe" }, "stripe")).toBe(true);
});

test("SAFE-015: after a save that failed, the page draws what is on disk, never the switch the user just flipped", async () => {
  // The rule was off on disk; the user flips it back on; the write fails.
  const disk: Record<string, unknown> = { [OFF_FIELD]: ["force-push"] };
  const failing = () => Promise.reject(new Error("settings.json is read-only"));
  const read = () => Promise.resolve({ ...disk });
  const after = await savedState(failing, read, switchRule(disk, "force-push", true));
  expect(after).toEqual({ [OFF_FIELD]: ["force-push"] });
  expect(switchOf(view(after as Record<string, unknown>), "Force-push to main")).not.toContain("checked");
  // A save that worked is read back as written; a read that fails leaves the page on its own state (null).
  const writing = (patch: Record<string, unknown>) => Promise.resolve(Object.assign(disk, patch));
  expect(await savedState(writing, read, switchRule(disk, "force-push", true))).toEqual({ [OFF_FIELD]: [] });
  expect(await savedState(writing, () => Promise.reject(new Error("gone")), switchAll(false))).toBeNull();
  // A save that throws at once, before returning a promise, is treated the same way.
  expect(await savedState(() => { throw new Error("boom"); }, read, switchAll(false))).toEqual(disk);
});
