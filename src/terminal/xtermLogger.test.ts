// Stress 802: the parse-error flood from random escape bytes.
// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import pane from "./TerminalPane.tsx?raw";
import { makeXtermLogger, xtermLogger } from "./xtermLogger";

function sink() {
  return { log: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

afterEach(() => vi.restoreAllMocks());

test("after802_parse_errors_are_summed_up_once_per_window_not_logged_each", () => {
  const s = sink();
  let t = 1_000;
  const log = makeXtermLogger(s, () => t);
  for (let i = 0; i < 5000; i++) log.error("Parsing error: ", { position: i });
  expect(s.error).not.toHaveBeenCalled();
  expect(s.warn).toHaveBeenCalledTimes(1);
  t += 10_001;
  log.error("Parsing error: ", {});
  expect(s.warn).toHaveBeenCalledTimes(2);
  expect(String(s.warn.mock.calls[1][0])).toContain("5000 malformed");
});

test("after802_other_errors_and_levels_still_reach_the_console", () => {
  const s = sink();
  const log = makeXtermLogger(s, () => 0);
  log.error("Parsing error: ", {});
  log.error("addon crashed", 42);
  log.error(new Error("boom"));
  log.warn("w");
  log.info("i");
  log.debug("d");
  log.trace("t");
  expect(s.error.mock.calls.map((c) => String(c[0]))).toEqual(["addon crashed", "Error: boom"]);
  expect(s.warn.mock.calls.some((c) => c[0] === "w")).toBe(true);
  expect(s.info).toHaveBeenCalledWith("i");
  expect(s.debug).toHaveBeenCalledWith("d");
  expect(s.log).toHaveBeenCalledWith("t");
});

/** xterm reports a byte its state machine has no move for as "Parsing error": a non-ASCII letter inside an escape sequence is one. */
function terminalFor(options: ConstructorParameters<typeof Terminal>[0]): Terminal {
  return new Terminal({ cols: 80, rows: 24, allowProposedApi: true, ...options });
}

function write(term: Terminal, data: string): Promise<void> {
  return new Promise((done) => term.write(data, done));
}

const BAD = "\x1b[é".repeat(3000);

test("after802_control_a_default_terminal_logs_every_parse_error", async () => {
  const flood = vi.spyOn(console, "error").mockImplementation(() => {});
  const term = terminalFor({});
  await write(term, BAD);
  // with no logger option xterm prefixes its messages with "xterm.js: "
  expect(flood.mock.calls.filter((c) => String(c[0]).includes("Parsing error")).length).toBe(3000);
  term.dispose();
});

test("after802_a_terminal_given_the_logger_stays_quiet_and_keeps_working", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
  const term = terminalFor({ logger: xtermLogger });
  await write(term, `${BAD}after`);
  expect(errors).not.toHaveBeenCalled();
  expect(warns.mock.calls.length).toBeLessThanOrEqual(1);
  expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe("after");
  term.dispose();
});

test("after802_the_pane_terminal_is_created_with_the_logger", () => {
  expect(pane).toMatch(/new Terminal\(\{[^]*?logger: xtermLogger,/);
  expect(pane).toMatch(/import \{ xtermLogger \} from "\.\/xtermLogger"/);
});
