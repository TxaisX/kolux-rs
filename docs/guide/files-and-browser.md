# Files and browser

Open, edit and review a workspace's files without leaving Kolux, and keep a web page in a tab beside your terminals. Each of these is a tab in the same grid as your terminals; open them from the New tab menu in the layout strip (see [Terminals](terminals.md)).

## Open a file

| To do this | Use |
|---|---|
| Find a file in this workspace by name | Ctrl+P ("Go to File") |
| Pick any single file on your computer | New tab menu, "File..." |
| Pick from the workspace's Markdown files | Ctrl+Shift+O, or "Open markdown file..." |
| Start a new Markdown note in the workspace | Ctrl+Shift+M, or "New markdown file" |
| Browse the workspace as a tree | Ctrl+Shift+E (the Explorer) |

The pickers filter as you type. Arrow keys move, Enter opens, Esc closes. If the workspace has none, you see "This worktree has no files." These menu items need an open workspace; otherwise Kolux says "Open a workspace to pick one of its changed files" and similar.

A file you pick with "File..." is the only thing Kolux grants access to. See [Safety](safety.md).

## Edit and save

Each file opens in its own tab, coloured by language. Ctrl+S saves. The same file open in two panes shares one text, so edits show in both.

- A small dot on the tab means "Unsaved changes". It means the text differs from the file on disk by more than trailing spaces.
- Ctrl+W closes the tab. Closing the whole window with unsaved text asks first: Keep working, or Quit without saving.
- Ctrl+F finds text in the editor. Your editor font follows Settings, Appearance, "Editor font".
- A file that will not open is tried three times, then the tab says "<name> did not open: <error>" with a **Retry** button. If the reason is that the file is outside your projects, an **Open this file anyway** button grants that one file for this session.
- A failed save shows "<name> was not saved: <error>" and keeps the unsaved dot.

### If the file changed under you

Kolux checks when you save, not while you type. If an agent or another program changed the file after you opened it, the save is refused and the tab says "<name> changed on disk since you opened it, so it was not saved."

| Button | What it does |
|---|---|
| Reload | Shows the disk copy and drops your unsaved edits |
| Keep mine | Saves your text over the disk copy |

If reloading fails, the tab says "<name> did not reload: <error>".

### Markdown

Markdown files open in a **Rich** view that shows headings, lists and links as formatted text. Switch to **Source** to see the raw text. A file over 600 KB opens in Source with a banner and an **Open anyway** button. A file the rich view cannot show faithfully (for example one with underlined headings or horizontal rules) opens in Source too, with the reason. A "Markdown preview" tab (Ctrl+Shift+V) shows a read-only rendering beside the editor.

### Copy with context and review notes

- **Copy Context** (Ctrl+Alt+C) copies your selection with its file path and line range, ready to paste into an agent. The editor says "Copied with path and lines".
- **Review notes:** select text and press Ctrl+Shift+A to leave a note for an agent. The switch is in Settings, General, Review notes. Notes can be sent to the agent from Source Control. See [Projects and worktrees](projects-and-worktrees.md).

## The Explorer

A tree of the workspace's files in a panel on the right. Ctrl+Shift+E shows or hides it. It re-reads the folders when the window regains focus, so files made outside Kolux show up without a button.

| To do this | Do this |
|---|---|
| Move the highlight | Arrow keys, Home, End |
| Open a folder or step into it | Right arrow |
| Fold a folder or climb to its parent | Left arrow |
| Open a file | Enter or click |
| Select several rows | Ctrl-click or Shift-click |
| New file, new folder | The two buttons in the Explorer's header |
| Rename in place | F2, then Enter to keep the name or Esc to cancel |
| Delete | Delete key. Moves to the trash after one question (on a WSL share it deletes for good and says so) |
| Undo, redo a file operation | Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y |
| Copy the path | Alt+Shift+C; with Ctrl+Alt+Shift+C you get the relative path |
| Copy files | Ctrl+C then Ctrl+V into a folder. A taken name gets " copy" |
| Move files | Drag rows onto a folder |
| Add files from your desktop | Drop them on a folder; they are copied |

If a folder cannot be read, the panel says "The folder did not load: <error>" with a Retry button.

## See what changed

Two tabs show a workspace's uncommitted changes:

- **Diff** (New tab menu, "Changed file diff...") shows one file's changes. Choose **Inline** or **Side by side**. F7 and Shift+F7 jump to the next and previous change. The "Diff actions" menu has "Show whitespace changes" and "Wrap lines". A tag shows whether you are looking at Staged or Unstaged changes.
- **All Changes** shows every changed file in one scrolling view, with a file list beside it. Filter that list by name. "Viewed" marks a file you have read. It says "This worktree has no changes." when there is nothing. Each file shows its Before and After text.

Diff lines also take review notes ("What should change here?"). A note needs some text; to remove one, use the bin on its card. Staging, committing and discarding are in [Projects and worktrees](projects-and-worktrees.md).

## Browser tabs

Open a web page beside your terminals, for example your app running locally. New tab menu, "Browser", or Ctrl+Shift+B.

| To do this | Do this |
|---|---|
| Go to a site | Type in the **Address** box and press Enter |
| Focus the address box | Ctrl+L |
| Back, forward | Alt+Left, Alt+Right (or the buttons) |
| Reload, stop | Ctrl+R; the Stop button while a page is loading |
| Close the tab | Ctrl+W |

What the address box understands:

| You type | Kolux does |
|---|---|
| `https://...` or `http://...` | Opens it |
| `localhost:3000` or `127.0.0.1:5173` | Opens it over http |
| `example.com` (looks like a domain, no spaces) | Opens it over https |
| Anything else | Searches the web with Google |
| A file path, `file:`, or another kind of link such as `mailto:` | Refuses: "a browser tab opens web pages only (http or https)" |

A browser tab never opens local files, so a page cannot reach the app's own tools. Pages stay loaded when you switch to another tab and back. There is no choice of search engine; the setting was removed.

## Not available

Find on a page, "grab page element" and hard reload have keys listed on the Shortcuts page, but they do nothing yet in this version. Use Ctrl+R to reload.

<!-- verified against: src/editor/EditorPane.tsx, src/editor/DiffPane.tsx, src/editor/AllChangesPane.tsx, src/editor/Explorer.tsx, src/editor/FilePicker.tsx, src/editor/PreviewPane.tsx, src/editor/markdown.ts, src/browser/BrowserPane.tsx, src/browser/address.ts, src/chrome/LayoutStrip.tsx, src/keys/actions.ts, src/App.tsx at 106e966 -->
