// EDIT-005: find and replace in a code editor. Kolux's own shortcuts open the bar (editor.find,
// Mod+F; editor.replace, Mod+H; both rebindable in keybindings.json, so CodeMirror's built-in
// Mod+F is switched off and a rebound chord is the only one that opens it). The box takes the
// selection only when text is really selected, never the word at the caret; otherwise it keeps
// the previous search. Find shows one field; replace adds the second. The first Escape closes the
// bar and stops there, so a dialog holding the editor only sees a second Escape.
import { Prec, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { closeSearchPanel, getSearchQuery, openSearchPanel, search, SearchQuery, setSearchQuery } from "@codemirror/search";

export const setReplace = StateEffect.define<boolean>();

/** Whether the bar shows the replace field. */
export const replaceShown = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(setReplace) ? e.value : acc), v),
});

/** The text the find box starts with: an explicit one-line selection, else the previous search. */
export function seedFor(state: EditorState, previous: string): string {
  const sel = state.selection.main;
  if (sel.empty || sel.to - sel.from > 100) return previous;
  const text = state.sliceDoc(sel.from, sel.to);
  return text.includes("\n") ? previous : text;
}

/** The last search in any editor, so a newly opened tab's box starts with it too. */
let lastSearch = "";

export function openFind(view: EditorView, replace: boolean): boolean {
  const prev = getSearchQuery(view.state);
  const search = seedFor(view.state, prev.search || lastSearch);
  view.dispatch({ effects: setReplace.of(replace && !view.state.readOnly) });
  openSearchPanel(view);
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ ...prev, search })) });
  const box = view.dom.querySelector<HTMLInputElement>(replace ? ".cm-search [name=replace]" : ".cm-search [name=search]");
  if (box) {
    box.value = replace ? box.value : search;
    box.focus();
    box.select();
  }
  return true;
}

export const findSupport: Extension = [
  // The bar sits over the editor, at the top.
  search({ top: true }),
  replaceShown,
  EditorView.editorAttributes.compute([replaceShown], (s) => ({ class: s.field(replaceShown) ? "kx-replace" : "kx-find" })),
  EditorView.updateListener.of((u) => {
    const q = getSearchQuery(u.state).search;
    if (q) lastSearch = q;
  }),
  Prec.highest(
    keymap.of([
      // Kolux's keymap opens the bar; CodeMirror's own Mod+F would ignore a rebinding.
      { key: "Mod-f", run: () => true },
      { key: "Escape", run: closeSearchPanel, scope: "editor search-panel", stopPropagation: true },
    ]),
  ),
  EditorView.baseTheme({
    "&.kx-find .cm-search [name=replace], &.kx-find .cm-search button[name=replace], &.kx-find .cm-search button[name=replaceAll], &.kx-find .cm-search br": { display: "none" },
  }),
];
