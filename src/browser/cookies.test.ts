import { expect, it } from "vitest";
import { CHROME_STEPS, cookieReportText, dismissHint, GOOGLE_NOTE, HINT_KEY, hintDismissed, importHintText, IMPORT_SOURCES, pickerFor } from "./cookies";

it("BROW-030: the hint names the supported sources until browsers are found, then shortens long lists", () => {
  expect(importHintText(null)).toBe("Import logins from Google Chrome or a file");
  expect(importHintText([])).toBe("Import logins from Google Chrome or a file");
  expect(importHintText(["Microsoft Edge"])).toBe("Import logins from Microsoft Edge");
  expect(importHintText(["Google Chrome", "Microsoft Edge"])).toBe("Import logins from Google Chrome, Microsoft Edge");
  expect(importHintText(["Google Chrome", "Microsoft Edge", "Brave", "Firefox"])).toBe("Import logins from Google Chrome, Microsoft Edge +2");
});

it("BROW-030: dismissing hides the hint for good; storage that refuses never breaks the pane", () => {
  const kept = new Map<string, string>();
  const store = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
  expect(hintDismissed(store)).toBe(false); // fresh install: visible
  dismissHint(store);
  expect(kept.get(HINT_KEY)).toBe("1");
  expect(hintDismissed(store)).toBe(true); // a restart reads the same store
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  expect(hintDismissed(broken)).toBe(false);
  expect(() => dismissHint(broken)).not.toThrow();
  expect(hintDismissed(undefined)).toBe(false);
});

it("BROW-029: the toast gives Google advice only when Google rows really were left out", () => {
  const none = cookieReportText({ imported: 12, sites: 3, skipped: 0, google: 0, reasons: [] });
  expect(none).toBe("12 cookies for 3 sites imported");
  expect(none).not.toMatch(/google/i);
  const some = cookieReportText({ imported: 1, sites: 1, skipped: 1, google: 4, reasons: ["entry 3: no name"] });
  expect(some).toBe("1 cookie for 1 site imported; 1 skipped (entry 3: no name); 4 Google sign-in cookies left out; sign in to Google directly in this pane");
  expect(cookieReportText({ imported: 0, sites: 0, skipped: 0, google: 1, reasons: [] })).toContain("1 Google sign-in cookie left out");
});

it("BROW-029: the import button says up front that Google cookies are left out", () => {
  expect(GOOGLE_NOTE).toMatch(/Google cookies are left out/);
});

it("BROW-028: Chrome is a guided cookies.txt export, offered before a plain file", () => {
  expect(IMPORT_SOURCES.map((s) => s.source)).toEqual(["chrome", "file"]);
  expect(IMPORT_SOURCES[0].label).toMatch(/Google Chrome/);
  expect(CHROME_STEPS).toHaveLength(3);
  expect(CHROME_STEPS.join(" ")).toMatch(/cookies\.txt/);
  expect(CHROME_STEPS.join(" ")).not.toMatch(/decrypt|password|profile folder/i);
  expect(pickerFor("chrome").filters[0].extensions).toEqual(["txt"]);
  expect(pickerFor("file").filters[0].extensions).toEqual(["txt", "json"]);
});
