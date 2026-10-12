// TERM-098: programs that ask whether the terminal is light or dark get an answer, and ones that
// subscribe are told each time the mode flips. The sequences follow the public "dark and light
// mode detection" convention (DEC private mode 2031, report CSI ? 997 ; 1|2 n, query CSI ? 996 n).
// Colour queries (OSC 4, 10, 11, 12 with "?") are answered by xterm itself from the current theme.

type Params = (number | number[])[];
type Parser = { registerCsiHandler(id: { prefix?: string; final: string }, cb: (p: Params) => boolean): { dispose(): void } };

export const modeReport = (dark: boolean) => `\x1b[?997;${dark ? 1 : 2}n`;

export function hookColourMode(term: { parser: Parser }, send: (data: string) => void, isDark: () => boolean) {
  let subscribed = false;
  let told = isDark();
  const only2031 = (p: Params) => p.length === 1 && p[0] === 2031;
  const set = (on: boolean) => (p: Params) => {
    if (p.includes(2031)) subscribed = on;
    if (on) told = isDark();
    return only2031(p);
  };
  const hooks = [
    term.parser.registerCsiHandler({ prefix: "?", final: "h" }, set(true)),
    term.parser.registerCsiHandler({ prefix: "?", final: "l" }, set(false)),
    term.parser.registerCsiHandler({ prefix: "?", final: "n" }, (p) => {
      if (p.length !== 1 || p[0] !== 996) return false;
      send(modeReport(isDark()));
      return true;
    }),
  ];
  return {
    /** Call after the app's appearance changes. */
    changed() {
      const dark = isDark();
      if (subscribed && dark !== told) send(modeReport(dark));
      told = dark;
    },
    dispose: () => hooks.forEach((h) => h.dispose()),
  };
}
