import { expect, test } from "vitest";
import { hookColourMode, modeReport } from "./colourMode";

type Handler = (params: (number | number[])[]) => boolean;
function fakeTerm() {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    parser: {
      registerCsiHandler(id: { prefix?: string; final: string }, cb: Handler) {
        handlers.set(`${id.prefix ?? ""}${id.final}`, cb);
        return { dispose: () => handlers.delete(`${id.prefix ?? ""}${id.final}`) };
      },
    },
  };
}

test("TERM-098: the light/dark report says 1 for dark and 2 for light", () => {
  expect(modeReport(true)).toBe("\x1b[?997;1n");
  expect(modeReport(false)).toBe("\x1b[?997;2n");
});

test("TERM-098: a program asking for the mode gets it, and a subscriber hears each flip", () => {
  const term = fakeTerm();
  const sent: string[] = [];
  let dark = true;
  const hook = hookColourMode(term, (d) => sent.push(d), () => dark);
  expect(term.handlers.get("?n")!([996])).toBe(true);
  expect(sent).toEqual(["\x1b[?997;1n"]);
  expect(term.handlers.get("?n")!([6]), "other device reports stay with xterm").toBe(false);

  dark = false;
  hook.changed();
  expect(sent.length, "nobody subscribed yet: nothing is sent").toBe(1);

  expect(term.handlers.get("?h")!([2031])).toBe(true);
  dark = true;
  hook.changed();
  hook.changed();
  expect(sent, "told once per flip, never twice for the same mode").toEqual(["\x1b[?997;1n", "\x1b[?997;1n"]);

  expect(term.handlers.get("?h")!([2031, 25]), "a mixed set leaves the rest to xterm").toBe(false);
  expect(term.handlers.get("?l")!([2031])).toBe(true);
  dark = false;
  hook.changed();
  expect(sent.length, "unsubscribed: quiet again").toBe(2);
  expect(term.handlers.get("?h")!([25])).toBe(false);

  hook.dispose();
  expect(term.handlers.size).toBe(0);
});
