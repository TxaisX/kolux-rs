// Cycle 2 (the App.tsx split): the window's source text for the tests that read it (paneStatus, paneMark,
// commands, savedLaunch, noticeMount, explorerBar, main.slowStart): App.tsx and the files its code was
// moved into, as one text. A test helper, imported by tests only.
const FILES = import.meta.glob(["../App.tsx", "./windowStore.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Every window file's text, App.tsx first, joined by a blank line. */
export const windowSource: string = ["../App.tsx", ...Object.keys(FILES).filter((f) => f !== "../App.tsx").sort()].map((f) => FILES[f]).join("\n\n");
