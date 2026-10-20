import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { RepoSetupView } from "./RepoSetup";
import { choiceOptions, choiceSave, effectiveChoice, runsNote, scriptSave, trustNote, type RepoSetup } from "./setupChoice";

const base: RepoSetup = { local: null, shared: null, sharedError: null, policy: null, inherited: "local", wait: false, suggestBoth: false };

test("SET-033: a script draft is saved only when it changed, and an emptied one is not a save", () => {
  expect(scriptSave(null, "")).toEqual({ kind: "none" });
  expect(scriptSave(null, "  \n")).toEqual({ kind: "none" });
  expect(scriptSave("pnpm i", "pnpm i\n")).toEqual({ kind: "none" });
  expect(scriptSave("make\nmake test", "make\r\nmake test")).toEqual({ kind: "none" });
  expect(scriptSave(null, " pnpm i \n")).toEqual({ kind: "save", script: "pnpm i" });
  expect(scriptSave("pnpm i", "pnpm ci")).toEqual({ kind: "save", script: "pnpm ci" });
  // emptying a saved script is what Remove is for: it says so instead of writing nothing silently
  expect(scriptSave("pnpm i", "  ")).toEqual({ kind: "empty" });
});

test("SET-033: the run choice shows what it inherits and saves only a change", () => {
  expect(effectiveChoice(base)).toBe("local");
  expect(effectiveChoice({ ...base, inherited: "shared" })).toBe("shared");
  expect(effectiveChoice({ ...base, inherited: "shared", policy: "both" })).toBe("both");
  const o = choiceOptions({ ...base, inherited: "shared" });
  expect(o.map((x) => x.value)).toEqual(["", "local", "shared", "both"]);
  expect(o[0].label).toBe("Same as everywhere (the shared script only)");
  expect(choiceSave(base, "")).toBeNull();
  expect(choiceSave(base, "both")).toEqual({ policy: "both" });
  expect(choiceSave({ ...base, policy: "both" }, "both")).toBeNull();
  expect(choiceSave({ ...base, policy: "both" }, "")).toEqual({ policy: null });
  expect(choiceSave(base, "shared-first")).toBeNull();
});

test("SET-033: the page says which scripts run, suggests both when both exist, and says what asks first", () => {
  expect(runsNote(base)).toBe("Nothing runs: there is no setup script yet.");
  expect(runsNote({ ...base, local: "make" })).toBe("Runs your saved setup.");
  expect(runsNote({ ...base, shared: "pnpm i" })).toBe("Runs the setup script from kolux.yaml.");
  expect(runsNote({ ...base, local: "make", shared: "pnpm i" })).toBe("Runs your saved setup; kolux.yaml's setup script is not used.");
  expect(runsNote({ ...base, local: "make", shared: "pnpm i", policy: "both" })).toBe("Runs your saved setup, then the setup script from kolux.yaml.");
  expect(runsNote({ ...base, local: "make", shared: "pnpm i", policy: "shared" })).toBe("Runs the setup script from kolux.yaml only; your saved setup is not used.");
  expect(runsNote({ ...base, local: "make", policy: "shared" })).toBe("Nothing runs: the choice is kolux.yaml's setup script, and it has none.");
  expect(trustNote({ ...base, local: "make" })).toBe("Your own setup runs without asking.");
  expect(trustNote({ ...base, local: "make", shared: "pnpm i" })).toBe("Your own setup runs without asking.");
  expect(trustNote({ ...base, shared: "pnpm i" })).toBe("The script in kolux.yaml asks first, once, and again if it changes.");
  expect(trustNote({ ...base, local: "make", shared: "pnpm i", policy: "both" })).toBe("Your own setup runs without asking. The script in kolux.yaml asks first, once, and again if it changes.");
  expect(trustNote(base)).toBe("");
  expect(trustNote({ ...base, shared: "pnpm i", policy: "both" })).toBe("The script in kolux.yaml asks first, once, and again if it changes.");
  expect(trustNote({ ...base, local: "make", shared: "pnpm i", policy: "local" })).toBe("Your own setup runs without asking.");
  expect(trustNote({ ...base, local: "make", shared: "pnpm i", policy: "shared" })).toBe("The script in kolux.yaml asks first, once, and again if it changes.");
});

const none = { onSave: () => {}, onRemove: () => {}, onChoice: () => {}, onWait: () => {} };
const view = (setup: RepoSetup, notice: string | null = null) => renderToString(createElement(RepoSetupView, { setup, notice, actions: none }));

test("SET-033 / PROJ-035: the section shows the saved setup with a Remove row, the kolux.yaml script and the wait choice", () => {
  const empty = view(base);
  expect(empty).toContain("Runs in a new tab when a workspace is made.");
  expect(empty).toContain("Nothing runs: there is no setup script yet.");
  expect(empty).not.toContain("Remove");
  expect(empty).toContain('aria-label="Wait for setup"');
  expect(empty).not.toContain("checked");
  const saved = view({ ...base, local: "pnpm i", wait: true });
  expect(saved).toContain("pnpm i</textarea>");
  expect(saved).toContain("Remove");
  expect(saved).toContain("checked");
  expect(saved).toContain("Your own setup runs without asking.");
  const both = view({ ...base, local: "make", shared: "pnpm i", suggestBoth: true });
  expect(both).toContain("data-suggest=\"both\"");
  expect(both).toContain("Run both");
  expect(both).toContain("That is the setup script in this repository");
  expect(view({ ...base, local: "make", shared: "pnpm i", policy: "both" })).not.toContain("data-suggest");
  expect(view({ ...base, local: "make", shared: "pnpm i", policy: "both" })).toContain("The script in kolux.yaml asks first");
  expect(view({ ...base, sharedError: "kolux.yaml could not be read: x" })).toContain("kolux.yaml could not be read: x");
  expect(view(base, "that failed")).toContain("that failed");
});
