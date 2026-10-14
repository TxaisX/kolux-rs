import { expect, test } from "vitest";
import { cleanApps, commandOf, FILE_MANAGER, MAX_APPS, targetsOf, VS_CODE } from "./openIn";

test("EDIT-043: out of the box the menu offers VS Code, then the file manager", () => {
  expect(targetsOf(null)).toEqual([VS_CODE, FILE_MANAGER]);
  expect(targetsOf({})).toEqual([VS_CODE, FILE_MANAGER]);
});

test("EDIT-043: a row with a label but no command, or a command but no label, is discarded; the list is capped", () => {
  const apps = cleanApps([{ label: "Mine", command: "" }, { label: "", command: "zed" }, { label: " Zed ", command: " zed " }, { label: "Bad", command: 7 }, null]);
  expect(apps).toEqual([{ label: "Zed", command: "zed" }]);
  const many = Array.from({ length: MAX_APPS + 3 }, (_, i) => ({ label: `App ${i}`, command: `app${i}` }));
  expect(cleanApps(many).length).toBe(MAX_APPS);
  expect(cleanApps([])).toEqual([]);
  expect(targetsOf({ openInApps: [] })).toEqual([FILE_MANAGER]);
});

test("EDIT-043: an app with an empty command launches VS Code; the file manager has no command", () => {
  expect(commandOf({ label: "Mine", command: "  " })).toBe("code");
  expect(commandOf({ label: "Zed", command: "zed --new" })).toBe("zed --new");
  expect(commandOf(FILE_MANAGER)).toBe(null);
});
