// BROW-005: the history the app keeps for a tab, from what the toolbar asked and the loads the page starts.
import { expect, test } from "vitest";
import { can, fresh, started } from "./history";

const A = "https://a.test/";
const B = "https://b.test/";

test("new pages add entries, the toolbar's back and forward move the cursor (BROW-005)", () => {
  let h = fresh();
  expect(can(h)).toEqual({ back: false, forward: false });
  h = started({ ...h, busy: false }, null, A);
  h = started({ ...h, busy: false }, null, B);
  expect(h.urls).toEqual(["about:blank", A, B]);
  expect(can(h)).toEqual({ back: true, forward: false });
  h = started({ ...h, busy: false }, "back", A);
  expect(h.at).toBe(1);
  expect(can(h)).toEqual({ back: true, forward: true });
  h = started({ ...h, busy: false }, "forward", B);
  expect(h.at).toBe(2);
});

test("a redirect replaces the entry, a reload keeps it, and the page's own back or forward moves the cursor (T-012-b-fix)", () => {
  let h = started({ ...fresh(), busy: false }, null, A);
  h = started(h, null, "https://a.test/landing"); // started while A was still loading
  expect(h.urls).toEqual(["about:blank", "https://a.test/landing"]);
  h = started({ ...h, busy: false }, "same", "https://a.test/landing");
  expect(h.urls.length).toBe(2);
  h = started({ ...h, busy: false }, null, B);
  // the site's own history.back(): nothing was asked, the load is the previous entry
  h = started({ ...h, busy: false }, null, "https://a.test/landing");
  expect(h.at).toBe(1);
  expect(can(h)).toEqual({ back: true, forward: true });
  h = started({ ...h, busy: false }, null, B);
  expect(h.at).toBe(2);
  expect(h.urls.length).toBe(3);
});
