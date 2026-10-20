// TERM-101 / TERM-104: the two drawing options that come from xterm itself, kept apart so the rules
// are testable without a terminal. A program's own cursor shape (DECSCUSR) is handled by xterm: it
// wins until the program resets it, and the chosen style returns (nothing to build here).
import type { ITerminalOptions } from "@xterm/xterm";

export type CursorLook = "block" | "bar" | "underline";

/** TERM-101: an unfocused pane shows a hollow cursor only for the block style; a bar or an
 *  underline keeps its own shape (it is already thin, so there is nothing to hollow out). */
export const inactiveCursor = (style: CursorLook): "outline" | "bar" | "underline" => (style === "block" ? "outline" : style);

/** TERM-104: wide characters take two cells (Unicode 16 widths and emoji sequences come from our
 *  own provider, unicodeWidth.ts), the cursor follows the cell count, and a glyph the font draws
 *  wider than its cell is squeezed back into it so the right edge of a table stays clean (emoji and
 *  Nerd Font glyphs are never rescaled; WebGL renderer only). Arabic shaping is the font's job. */
export const drawOptions = (style: CursorLook): Pick<ITerminalOptions, "cursorInactiveStyle" | "rescaleOverlappingGlyphs"> => ({
  cursorInactiveStyle: inactiveCursor(style),
  rescaleOverlappingGlyphs: true,
});
