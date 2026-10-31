// Which files open as a rich note: kept out of editor/markdown.ts, which registers Lexical and every
// node the note draws, so the window's shortcut router can ask the question without carrying the rich
// note editor into the first frame (cycle 3, first load). No DOM and no Lexical here.

/** A Markdown file: the editor tab opens it in rich mode, and Mod+Shift+V previews it. */
export const isMarkdown = (path: string) => /\.(md|markdown)$/i.test(path);
