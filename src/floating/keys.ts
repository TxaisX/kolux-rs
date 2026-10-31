// The floating layer's latch on the window's keys, kept in its own module so the shortcut router can
// ask it without carrying the editors and the browser page it can open (cycle 3, first load). The
// layer sets `handle` while it is mounted and puts the plain refusal back when it goes.

/**
 * The window asks this first for every key: true means the layer handled it (a panel command, or a
 * tab command while focus is inside the open panel) and the window must do nothing more. It works on
 * every screen, so Mod+S in a floating editor saves outside a workspace screen too.
 */
export const floatingKeys = { handle: (_e: KeyboardEvent): boolean => false };
