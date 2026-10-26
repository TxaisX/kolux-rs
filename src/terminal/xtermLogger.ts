// Stress 802: xterm.js logs "Parsing error" through console.error for each malformed escape sequence a program prints (12464 lines for 2 MB of noise). Those go quiet; every other message still reaches the console.
import type { ILogger } from "@xterm/xterm";

const PARSE_ERROR = "Parsing error";
const SUMMARY_EVERY_MS = 10_000;

type Sink = Pick<Console, "debug" | "info" | "warn" | "error"> & { log: Console["log"] };

/** The logger a pane's Terminal gets: parse errors are counted and summed up once per window, the rest is passed through. */
export function makeXtermLogger(sink: Sink = console, now: () => number = Date.now): ILogger {
  let muted = 0;
  let windowStart = -Infinity;
  return {
    trace: (m, ...a) => sink.log(m, ...a),
    debug: (m, ...a) => sink.debug(m, ...a),
    info: (m, ...a) => sink.info(m, ...a),
    warn: (m, ...a) => sink.warn(m, ...a),
    error: (m, ...a) => {
      if (typeof m !== "string" || !m.startsWith(PARSE_ERROR)) return sink.error(m, ...a);
      muted++;
      const t = now();
      if (t - windowStart < SUMMARY_EVERY_MS) return;
      sink.warn(`xterm: ${muted} malformed escape sequence(s) in program output${muted > 1 ? " since the last note" : ""}; more are counted, not logged (${SUMMARY_EVERY_MS / 1000} s)`);
      muted = 0;
      windowStart = t;
    },
  };
}

/** One logger for every pane: the count is per page, which is what a flood of noise should be judged by. */
export const xtermLogger: ILogger = makeXtermLogger();
