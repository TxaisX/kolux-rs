import { describe, expect, it } from "vitest";
import { kindOf, lanes, rangeStart, segments, ticks, type Track } from "./timeline";

const at = (h: number, m = 0) => new Date(2026, 9, 13, h, m).getTime();
const track = (o: Partial<Track>): Track => ({ pane: 1, marks: [], ended: null, terminal: 7, live: true, ...o });

describe("VIEW-013 Floor timeline", () => {
  it("range today at 09:00 starts the axis at local midnight, with six ticks", () => {
    expect(rangeStart("today", at(9))).toBe(at(0));
    expect(rangeStart("15m", at(9))).toBe(at(8, 45));
    const t = ticks(at(0), at(9));
    expect(t).toHaveLength(6);
    expect([t[0], t[5]]).toEqual([at(0), at(9)]);
  });

  it("an agent blocked on approval for 5 minutes gives a needs-you segment of that length", () => {
    const t = track({ marks: [{ at: at(8, 50), state: "working" }, { at: at(8, 52), state: "permission" }, { at: at(8, 57), state: "working" }] });
    const segs = segments(t, rangeStart("60m", at(9)), at(9));
    expect(segs.map((s) => s.kind)).toEqual(["working", "needs", "working"]);
    expect(segs[1].to - segs[1].from).toBe(5 * 60_000);
  });

  it("blocked and waiting both read needs-you; segments are clamped to the range", () => {
    expect(["blocked", "waiting", "permission"].map(kindOf)).toEqual(["needs", "needs", "needs"]);
    const segs = segments(track({ marks: [{ at: at(7), state: "working" }] }), at(8, 45), at(9));
    expect(segs).toEqual([{ kind: "working", from: at(8, 45), to: at(9) }]);
  });

  it("a lane with no live terminal shows its quiet stretches as unverifiable, and stops where the pane closed", () => {
    const closed = track({ live: false, ended: at(8, 55), marks: [{ at: at(8, 50), state: "done" }] });
    expect(segments(closed, at(8), at(9))).toEqual([{ kind: "unverifiable", from: at(8, 50), to: at(8, 55) }]);
    expect(segments({ ...closed, live: true }, at(8), at(9))[0].kind).toBe("idle");
  });

  it("lanes come in pane order and a lane with nothing in range is left off", () => {
    const tracks = [track({ pane: 5, marks: [{ at: at(8, 59), state: "working" }] }), track({ pane: 2, marks: [{ at: at(8, 59), state: "idle" }] }), track({ pane: 3, ended: at(7), marks: [{ at: at(6), state: "working" }] })];
    expect(lanes(tracks, at(8), at(9)).map((l) => l.track.pane)).toEqual([2, 5]);
  });

  it("the page draws one lane per pane with its segments and six ticks", async () => {
    const { createElement } = await import("react");
    const { renderToString } = await import("react-dom/server");
    const { default: FloorView } = await import("./FloorView");
    const html = renderToString(createElement(FloorView, { now: at(9), initial: [track({ marks: [{ at: at(8, 52), state: "permission" }, { at: at(8, 57), state: "working" }] })] }));
    expect(html.match(/class="floor-lane"/g)).toHaveLength(1);
    expect(html).toContain('data-ms="300000"');
    expect(html.match(/class="floor-tick"/g)).toHaveLength(6);
  });
});
