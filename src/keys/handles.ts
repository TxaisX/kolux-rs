// The latches a surface fills while it is open and the window's shortcut router calls into. They live
// apart from the panes that set them so a shortcut does not carry CodeMirror and everything it draws
// into the window's first frame (cycle 3, first load): the router holds the empty map, the pane fills
// it when the file is opened, and the same object is read a key press later.

/** Save for each open editor pane, by pane key; the window's Mod+S calls the focused one. */
export const editors = new Map<number, () => Promise<void>>();
/** EDIT-007: Copy Context for each open editor pane; false when this tab cannot copy that way. */
export const copiers = new Map<number, () => boolean>();
/** The change stepper each open diff tab fills (EDIT-056): F7 and Shift+F7 call it, `dir` -1 for back. */
export const diffNav = new Map<number, (dir: 1 | -1) => void>();
