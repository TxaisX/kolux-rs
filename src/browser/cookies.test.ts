import { expect, it } from "vitest";
import { cookieReportText, GOOGLE_NOTE } from "./cookies";

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
