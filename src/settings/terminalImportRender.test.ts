// TERM-099 / TERM-100 (T-307, FIX-3b): the two "Bring in" boxes of Settings > Terminal, driven through the
// real components. There is no DOM test renderer in this repo, so React's useState is swapped for a tiny
// runtime (state slots, a redraw by hand), the same way useWizard.test.ts does it. What is checked is
// what the box does: a save that did not reach the disk leaves the window unpainted and says so, and
// the preview is the plan that Bring in saves (a scheme refused at the cap says "Will not add").
// The stand-in walks plain elements only. It fails on any element that is not a plain tag (a component
// the walker would not render, so its lines would go unchecked) and on a button that is disabled when
// it is clicked (the real browser would not deliver that click). FIX-4.
import { Fragment, type ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ slots: [] as unknown[], i: 0, painted: 0, disk: {} as Record<string, unknown>, files: [] as unknown[], themes: {} as Record<string, string | null | { skipped: string }>, warp: [] as unknown[], saves: [] as Record<string, unknown>[], reachesDisk: false }));

vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  function useState<T>(init: T | (() => T)) {
    const k = h.i++;
    if (!(k in h.slots)) h.slots[k] = typeof init === "function" ? (init as () => T)() : init;
    const set = (v: T | ((x: T) => T)) => void (h.slots[k] = typeof v === "function" ? (v as (x: T) => T)(h.slots[k] as T) : v);
    return [h.slots[k] as T, set] as const;
  }
  return { ...real, useState, default: { ...real, useState } };
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: { name: string }) => {
    if (cmd === "term_import_ghostty") return h.files;
    if (cmd === "term_import_ghostty_theme") {
      // The shape of the real command: { text } or { skipped } when found, null when found nowhere.
      const t = h.themes[args!.name] ?? null;
      return typeof t === "string" ? { text: t } : t;
    }
    if (cmd === "term_import_warp") return h.warp;
    if (cmd === "get_settings") return { ...h.disk };
    throw new Error("unexpected " + cmd);
  },
}));
vi.mock("../theme", async (orig) => ({ ...(await orig<typeof import("../theme")>()), applyAppearance: () => void h.painted++ }));

const { GhosttyImportBox, WarpImportBox } = await import("./TerminalImport");

type Props = Parameters<typeof GhosttyImportBox>[0];
type El = { type?: unknown; props: { children?: ReactNode; disabled?: boolean; onClick?: () => void; onChange?: (e: { target: { checked: boolean } }) => void; "aria-label"?: string } };

/** Only plain tags (and fragments) can be walked: anything else would hide its lines from every check below. */
function plain(e: El): El {
  if (typeof e.type !== "string" && e.type !== Fragment) throw new Error("the render test walks plain elements only; found a non-intrinsic element type: " + String((e.type as { name?: string } | undefined)?.name ?? e.type));
  return e;
}

const text = (n: ReactNode): string => {
  if (n === null || n === undefined || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(text).join(" ");
  return text(plain(n as El).props.children);
};
const find = (n: ReactNode, pick: (e: El) => boolean): El | null => {
  if (n === null || typeof n !== "object") return null;
  if (Array.isArray(n)) return n.map((c) => find(c, pick)).find(Boolean) ?? null;
  const e = plain(n as El);
  return pick(e) ? e : find(e.props.children, pick);
};
const button = (tree: ReactNode, label: string) => find(tree, (e) => e.type === "button" && text(e.props.children).replace(/\s+/g, " ").trim() === label);
const settle = () => new Promise((r) => setTimeout(r, 0));

/** Clicks the button with this label, after checking it can be clicked at all. */
function click(tree: ReactNode, label: string) {
  const b = button(tree, label);
  expect(b, `a "${label}" button is shown`).not.toBeNull();
  expect(b!.props.disabled, `"${label}" is not disabled when it is clicked`).toBeFalsy();
  b!.props.onClick!();
}

/** Mounts a box, runs its first "Look for" button, and returns a way to redraw and click. */
async function open(Box: (p: Props) => ReactNode, look: string, props: Props) {
  h.slots = [];
  const draw = () => {
    h.i = 0;
    return Box(props);
  };
  click(draw(), look);
  await settle();
  return {
    draw,
    async click(label: string) {
      click(draw(), label);
      await settle();
    },
  };
}

const scheme = (name: string) => ({ name, background: "#000000", foreground: "#ffffff" });
const ghosttyFiles = [{ label: "config", text: "font-size = 14\ntheme = Night\n" }];
// A save that settles without error. When it reaches the disk the settings read back match the patch.
const makeSave = (settings: Record<string, unknown>) => async (patch: Record<string, unknown>) => {
  h.saves.push(patch);
  if (h.reachesDisk) Object.assign(h.disk, patch);
  void settings;
};

beforeEach(() => {
  h.painted = 0;
  h.saves = [];
  h.disk = {};
  h.files = ghosttyFiles;
  h.themes = { Night: "background = 000000\nforeground = ffffff\n" };
  h.warp = [{ name: "night.yaml", text: "accent: '#1b8fe3'\nbackground: '#1e1e1e'\nforeground: '#e0e0e0'\nterminal_colors:\n  bright:\n    black: '#555555'\n  normal:\n    black: '#000000'\n" }];
  h.reachesDisk = false;
});

test("Ghostty: a save that did not reach the disk leaves the window unpainted and shows the failure line", async () => {
  const settings = {};
  const box = await open(GhosttyImportBox, "Look for my Ghostty settings", { settings, save: makeSave(settings) });
  expect(text(box.draw())).toContain("Will add the colour scheme Night.");
  await box.click("Bring in");
  expect(h.saves).toHaveLength(1);
  expect(h.painted).toBe(0);
  const shown = text(box.draw());
  expect(shown).toContain("The import could not be saved, so nothing was changed. Try again.");
  expect(shown).not.toContain("Set ");
  // the import stays open to try again: Bring in is shown, can be clicked, and a second try reaches the save
  expect(button(box.draw(), "Bring in")).not.toBeNull();
  await box.click("Bring in");
  expect(h.saves).toHaveLength(2);
});

test("Ghostty: a theme the back end refused says why, not that it was not found", async () => {
  const settings = {};
  h.themes = { Night: { skipped: "is outside the theme folder" } };
  const box = await open(GhosttyImportBox, "Look for my Ghostty settings", { settings, save: makeSave(settings) });
  const shown = text(box.draw());
  // text() puts a space between a line's pieces, so the line is matched with the spaces loose
  expect(shown).toMatch(/Left out:\s+theme\s+=\s+Night\s+\(\s*its file is outside the theme folder\s*\)/);
  expect(shown).not.toContain("not found");
  // a theme found nowhere is still reported as not found
  h.themes = {};
  const none = await open(GhosttyImportBox, "Look for my Ghostty settings", { settings, save: makeSave(settings) });
  expect(text(none.draw())).toMatch(/Left out:\s+theme\s+=\s+Night\s+\(\s*not found in Ghostty's theme folders\s*\)/);
});

test("Ghostty: when the save reaches the disk the window is painted once and the result is shown", async () => {
  const settings = {};
  h.reachesDisk = true;
  const box = await open(GhosttyImportBox, "Look for my Ghostty settings", { settings, save: makeSave(settings) });
  await box.click("Bring in");
  expect(h.painted).toBe(1);
  const shown = text(box.draw());
  expect(shown).not.toContain("could not be saved");
  expect(shown).toContain("Added");
});

test("Ghostty: with 40 schemes saved the preview says Will not add, and never Will add", async () => {
  const settings = { terminalCustomSchemes: Array.from({ length: 40 }, (_, i) => scheme(`S${i}`)) };
  const box = await open(GhosttyImportBox, "Look for my Ghostty settings", { settings, save: makeSave(settings) });
  const shown = text(box.draw());
  expect(shown).toContain("Will not add Night, because you already have 40 custom schemes. Remove one first.");
  expect(shown).not.toContain("Will add");
});

test("Warp: a save that did not reach the disk leaves the window unpainted and shows the failure line", async () => {
  const settings = {};
  const box = await open(WarpImportBox, "Look for my Warp themes", { settings, save: makeSave(settings) });
  const tick = find(box.draw(), (e) => e.props["aria-label"] === "Bring in night")!;
  tick.props.onChange!({ target: { checked: true } });
  expect(tick.props.disabled).toBeFalsy();
  await box.click("Bring in 1");
  expect(h.saves).toHaveLength(1);
  expect(h.painted).toBe(0);
  expect(text(box.draw())).toContain("The themes could not be saved, so nothing was changed. Try again.");
  await box.click("Bring in 1"); // still offered, and a second try reaches the save
  expect(h.saves).toHaveLength(2);
});
