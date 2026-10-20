// BROW-013: the pane's download strip.
import { describe, expect, it } from "vitest";
import { busy, dismiss, type Download, fraction, human, LINGER_MS, progressText, prune, reduce, status } from "./downloads";

const d = (over: Partial<Download>): Download => ({ id: 1, key: 1, url: "https://x/report.pdf", name: "report.pdf", path: "C:\\Users\\me\\Downloads\\report.pdf", received: 0, total: null, state: "running", ...over });

describe("BROW-013 downloads strip", () => {
  it("shows bytes received and the total when both are known", () => {
    expect(progressText(0, null)).toBe("0 B");
    expect(progressText(1500, 4_500_000)).toBe("1.5 KB of 4.5 MB");
    expect(progressText(1500, 0)).toBe("1.5 KB");
    expect(human(2_000_000_000)).toBe("2.0 GB");
    expect(fraction(d({ received: 50, total: 200 }))).toBe(0.25);
    expect(fraction(d({ received: 50 }))).toBeNull();
    expect(fraction(d({ received: 500, total: 200 }))).toBe(1);
  });

  it("one row per download; a second download under the same name is its own row", () => {
    let rows = reduce([], d({ key: 1 }), 1000);
    rows = reduce(rows, d({ key: 2, name: "report (2).pdf" }), 1001);
    rows = reduce(rows, d({ key: 1, received: 10, total: 100 }), 1002);
    expect(rows.map((r) => [r.key, r.name, r.received])).toEqual([
      [1, "report.pdf", 10],
      [2, "report (2).pdf", 0],
    ]);
    expect(busy(rows)).toBe(true);
    expect(status(rows[0])).toBe("10 B of 100 B");
  });

  it("a finished row says so, lingers, then goes; a running row never goes on its own", () => {
    let rows = reduce([], d({ key: 1 }), 0);
    rows = reduce(rows, d({ key: 1, state: "done", received: 100, total: 100 }), 5000);
    expect(status(rows[0])).toBe("finished, 100 B");
    expect(busy(rows)).toBe(false);
    expect(prune(rows, 5000 + LINGER_MS - 1).length).toBe(1);
    expect(prune(rows, 5000 + LINGER_MS).length).toBe(0);
    const running = reduce([], d({ key: 3 }), 0);
    expect(prune(running, 10 * LINGER_MS).length).toBe(1);
    expect(dismiss(rows, 1)).toEqual([]);
  });

  it("closing the tab cancels its download, and a refused one says why", () => {
    const rows = reduce([], d({ key: 1, state: "cancelled" }), 0);
    expect(status(rows[0])).toBe("cancelled");
    expect(status(d({ state: "failed", path: "report.pdf: 100 files with this name are already in the Downloads folder" }))).toContain("failed: report.pdf: 100");
    expect(status(d({ state: "failed" }))).toBe("failed"); // a real path is not a reason
  });
});
