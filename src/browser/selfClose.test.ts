import { describe, expect, it } from "vitest";
import { SELF_CLOSE_EVENT, selfCloseNotice } from "./selfClose";

// Row 954 (b): the one-line notice a pane shows for the back end's `browser-selfclosed` event.

describe("row 954b: the self-close notice", () => {
  it("names the event the back end sends", () => {
    expect(SELF_CLOSE_EVENT).toBe("browser-selfclosed");
  });

  it("says Kolux reopened the page when it was rebuilt", () => {
    expect(selfCloseNotice({ id: 3, reopen: true })).toBe("This page closed itself; Kolux reopened it");
  });

  it("says it was left closed when the page kept doing it", () => {
    expect(selfCloseNotice({ id: 3, reopen: false })).toBe("This page keeps closing itself; Kolux left it closed");
  });
});
