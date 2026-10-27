// SESS-007: a grid chooser that is the only shown pane has no close button; the New session sheet is closed by its own button.
export function chooserClosable(shown: number, inSheet: boolean): boolean {
  return inSheet || shown > 1;
}
