// SET-022 / SET-025 / SET-026 (T-247-d): what a pane does with the input preferences of inputPrefs.ts. The
// saved values are read once into a cache that follows every settings save (text.ts feeds it, like the text
// settings), and the pane asks this file for the xterm options, the guarded ligatures addon, the middle-click
// and pointer rules and the GPU probe. No pane or page code is in here, so each rule is tested on its own.
import type { ITerminalAddon, ITerminalOptions } from "@xterm/xterm";
import type { Platform } from "../keys/actions";
import { detectPlatform } from "../keys/keymap";
import { optionIsMeta, pastesOnMiddle, pointerHidden, readInput, type InputPrefs } from "./inputPrefs";

let current: InputPrefs = readInput({}, detectPlatform());
/** The input preferences in force now; panes listen for INPUT_EVENT to follow changes. */
export const currentInput = () => current;
export const INPUT_EVENT = "kolux-terminal-input";

export function applyInput(s: Record<string, unknown> | null | undefined, platform: Platform = detectPlatform()): void {
  current = readInput(s ?? {}, platform);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(INPUT_EVENT));
}

/** A language other than English is taken to have a layout that types characters with Option (German @, Swedish {). */
// ponytail: language only; a real layout probe (keyboard.getLayoutMap) is not in the macOS web view, upgrade if "auto" guesses wrong.
export const optionTypesCharacters = (language: string): boolean => !/^en\b/i.test(language.trim());

/** The xterm options this file owns: Option as Meta (macOS) and the wheel speed, which differs in a full-screen program. */
export function inputOptions(p: InputPrefs, platform: Platform, language: string, alternate: boolean, normalScroll: number): ITerminalOptions {
  return {
    macOptionIsMeta: optionIsMeta(p, platform, optionTypesCharacters(language)),
    scrollSensitivity: alternate ? p.fullScreenScroll : normalScroll,
  };
}

/** A ligatures addon module, as the pane's dynamic import hands it over. */
export type LigaturesModule = { LigaturesAddon: new () => ITerminalAddon };

/** The ligatures addon, or null when it is not installed or cannot start here: the pane then draws plain text. */
export async function loadLigatures(load: () => Promise<LigaturesModule>): Promise<ITerminalAddon | null> {
  try {
    const mod = await load();
    return new mod.LigaturesAddon();
  } catch {
    return null;
  }
}

/** Middle button, switched on, and not a program that tracks the mouse (Shift takes the click back, as for the menu). */
export const middlePastes = (p: InputPrefs, e: { button: number; shiftKey: boolean }, trackingMode: string): boolean => pastesOnMiddle(p, e.button) && (trackingMode === "none" || e.shiftKey);

/** What a middle click pastes: the selection when there is one (the primary selection), else the clipboard. */
export const middleSource = (selection: string): "selection" | "clipboard" => (selection ? "selection" : "clipboard");

const POINTER_CLASS = "kolux-hide-pointer";
let styled = false;
function ensurePointerStyle(doc: Document) {
  if (styled) return;
  const style = doc.createElement("style");
  style.textContent = `.${POINTER_CLASS}, .${POINTER_CLASS} * { cursor: none !important; }`;
  doc.head.appendChild(style);
  styled = true;
}

type Target = Pick<HTMLElement, "addEventListener" | "removeEventListener" | "classList" | "ownerDocument">;

/** SET-025: the pointer hides at the first key in the pane and shows again at the next move. Returns the cleanup. */
export function watchPointer(el: Target, prefs: () => InputPrefs): () => void {
  let typing = false;
  const show = () => el.classList.toggle(POINTER_CLASS, pointerHidden(prefs(), typing));
  const down = () => {
    typing = true;
    if (prefs().hidePointer) ensurePointerStyle(el.ownerDocument);
    show();
  };
  const move = () => {
    typing = false;
    show();
  };
  el.addEventListener("keydown", down, true);
  el.addEventListener("mousemove", move);
  return () => {
    el.removeEventListener("keydown", down, true);
    el.removeEventListener("mousemove", move);
    el.classList.remove(POINTER_CLASS);
  };
}

/** Software drawing is no good for the GPU path: a WebGL context that is really a CPU rasteriser. */
export const softwareRenderer = (name: string): boolean => /swiftshader|llvmpipe|software|basic render/i.test(name);

/** What this machine offers the GPU path; any failure reads as no WebGL2. */
export function probeGpu(doc: Document = document): { webgl2: boolean; software: boolean } {
  try {
    const gl = doc.createElement("canvas").getContext("webgl2");
    if (!gl) return { webgl2: false, software: false };
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    return { webgl2: true, software: softwareRenderer(name) };
  } catch {
    return { webgl2: false, software: false };
  }
}
