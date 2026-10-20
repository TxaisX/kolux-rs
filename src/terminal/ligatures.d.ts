// T-247-d: the one part of @xterm/addon-ligatures the pane uses. Declared here so the code compiles in a tree where the
// package is not installed yet (loadLigatures then gets a failed import and the pane draws plain text).
declare module "@xterm/addon-ligatures" {
  import type { ITerminalAddon, Terminal } from "@xterm/xterm";
  export class LigaturesAddon implements ITerminalAddon {
    constructor(options?: { fallbackLigatures?: string[] });
    activate(terminal: Terminal): void;
    dispose(): void;
  }
}
