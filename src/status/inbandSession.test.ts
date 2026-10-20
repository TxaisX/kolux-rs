import { describe, expect, it } from "vitest";
import { dropsSession, forgetSession, inbandState, inbandTurn, onInbandTurn } from "./inbandSession";

describe("STAT-034 rest: an in-band status and the stored provider session", () => {
  it("reads the payload as Rust does: state, else status; unknown or malformed is nothing", () => {
    expect(inbandState('{"state":"working"}')).toBe("working");
    expect(inbandState('9999;{"status":"done"}')).toBe("done");
    expect(inbandState('{"state":"busy"}')).toBeNull();
    expect(inbandState("not json")).toBeNull();
    expect(inbandState("[1]")).toBeNull();
    expect(inbandState("null")).toBeNull();
  });

  it("only a new turn (working) drops the session; a completion and every other state keep it", () => {
    expect(dropsSession("working")).toBe(true);
    for (const s of ["done", "permission", "waiting", "idle", null] as const) expect(dropsSession(s)).toBe(false);
  });

  it("forgets only that pane's session and leaves the others' alone", () => {
    const panes = [{ key: 1, session: "a" }, { key: 2, session: "b" }, { key: 3 }];
    const out = forgetSession(panes, 1);
    expect(out).toEqual([{ key: 1 }, { key: 2, session: "b" }, { key: 3 }]);
    expect("session" in out[0]).toBe(false);
    expect(forgetSession(panes, 3)).toBe(panes);
    expect(forgetSession(panes, 9)).toBe(panes);
  });

  it("the pane's hand-off tells the listener on a new turn only, and stops after unsubscribing", () => {
    const seen: number[] = [];
    const off = onInbandTurn((k) => seen.push(k));
    expect(inbandTurn(4, '{"state":"working"}')).toBe(true);
    expect(inbandTurn(4, '{"state":"done"}')).toBe(false);
    expect(inbandTurn(4, '{"status":"permission"}')).toBe(false);
    expect(inbandTurn(undefined, '{"state":"working"}')).toBe(false);
    expect(seen).toEqual([4]);
    off();
    expect(inbandTurn(5, '{"state":"working"}')).toBe(true);
    expect(seen).toEqual([4]);
  });

  it("a completion after a new turn keeps what the hooks set again in between", () => {
    let panes: { key: number; session?: string }[] = [{ key: 7, session: "s1" }];
    const off = onInbandTurn((k) => (panes = forgetSession(panes, k)));
    inbandTurn(7, '{"state":"working"}');
    expect(panes).toEqual([{ key: 7 }]);
    panes = [{ key: 7, session: "s2" }]; // a hook names the conversation again
    inbandTurn(7, '{"state":"done"}');
    expect(panes).toEqual([{ key: 7, session: "s2" }]);
    off();
  });
});
