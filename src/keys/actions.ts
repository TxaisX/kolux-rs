// Every command a shortcut can name (COMPAT.md section 4.3, SET-013): its id (the key in the
// user's keybindings file, so it never changes), title, scope, conflict group and default chords
// per platform. "Mod" is Ctrl on Windows and Linux and Cmd on macOS. Linux takes the Windows
// column unless a row says otherwise. Two ids in the old table are not carried
// (`tab.newSimulator`, `tab.openQuickCommandsMenu`, see DECISIONS.md): they are not registered
// here, so a file naming them gets a warning, as any unknown id does.

export type Platform = "win32" | "linux" | "darwin";
export type Scope = "global" | "tabs" | "browser" | "editor" | "explorer" | "settings" | "terminal";
export type Group = "menu" | "workspace-shell" | "editor";

export type Action = {
  id: string;
  title: string;
  scope: Scope;
  group?: Group;
  /** Windows (and Linux) defaults; empty means it ships unbound. */
  win32: string[];
  /** Only when macOS differs from the Windows column. */
  darwin?: string[];
  /** The chord's last key is a digit 1; the action covers 1 to 9. */
  index?: boolean;
};

const agents: Array<[string, string]> = [
  ["claude", "Claude"],
  ["claude-agent-teams", "Claude Agent Teams"],
  ["openclaude", "OpenClaude"],
  ["codex", "Codex"],
  ["devin", "Devin"],
  ["ante", "Ante"],
  ["trae", "Trae"],
  ["autohand", "Autohand Code"],
  ["mimo-code", "MiMo Code"],
  ["pi", "Pi"],
  ["omp", "OMP"],
  ["prime-agent", "Prime Agent"],
  ["gemini", "Gemini"],
  ["antigravity", "Antigravity"],
  ["aider", "Aider"],
  ["goose", "Goose"],
  ["amp", "Amp"],
  ["kilo", "Kilocode"],
  ["kiro", "Kiro"],
  ["crush", "Charm"],
  ["aug", "Auggie"],
  ["cline", "Cline"],
  ["codebuff", "Codebuff"],
  ["command-code", "Command Code"],
  ["continue", "Continue"],
  ["cursor", "Cursor"],
  ["droid", "Droid"],
  ["kimi", "Kimi"],
  ["mistral-vibe", "Mistral Vibe"],
  ["qwen-code", "Qwen Code"],
  ["rovo", "Rovo Dev"],
  ["hermes", "Hermes"],
  ["openclaw", "OpenClaw"],
  ["copilot", "GitHub Copilot"],
  ["grok", "Grok"],
];

const a = (id: string, title: string, scope: Scope, win32: string[], extra: Partial<Action> = {}): Action => ({ id, title, scope, win32, ...extra });

export const actions: Action[] = [
  a("worktree.quickOpen", "Go to File", "global", ["Mod+P"]),
  a("app.settings", "Open Settings", "global", ["Mod+Comma"], { group: "menu" }),
  a("app.forceReload", "Force Reload", "global", ["Mod+Shift+R"], { group: "menu" }),
  a("worktree.palette", "Switch worktree", "global", ["Mod+Shift+J"], { darwin: ["Mod+J"] }),
  a("worktree.navigateUp", "Previous worktree", "global", ["Mod+Shift+ArrowUp"]),
  a("worktree.navigateDown", "Next worktree", "global", ["Mod+Shift+ArrowDown"]),
  a("workspace.create", "Create worktree", "global", ["Mod+N", "Mod+Shift+N"], { darwin: ["Mod+N"] }),
  a("workspace.rename", "Rename worktree", "global", [], { darwin: ["Mod+Alt+R"], group: "workspace-shell" }),
  a("workspace.delete", "Delete Workspace", "global", ["Mod+Shift+Backspace"]),
  a("workspace.openBoard", "Toggle Workspace Board", "global", []),
  a("dashboard.toggle", "Toggle Agent Dashboard", "global", []),
  a("workspace.selectByIndex", "Select Workspace 1–9", "global", ["Mod+1"], { index: true }),
  a("view.tasks", "Open Tasks", "global", []),
  a("sidebar.left.toggle", "Toggle Sidebar", "global", ["Mod+B"]),
  a("sidebar.right.toggle", "Toggle Right Sidebar", "global", ["Mod+L"]),
  a("sidebar.explorer.toggle", "Show Explorer", "global", ["Mod+Shift+E"]),
  a("sidebar.search.toggle", "Show Search", "global", ["Mod+Shift+F"]),
  a("sidebar.sourceControl.toggle", "Show Source Control", "global", ["Mod+Shift+G"]),
  a("sidebar.checks.toggle", "Show Checks", "global", []),
  a("sidebar.ports.toggle", "Show Ports", "global", [], { darwin: ["Mod+Shift+I"] }),
  a("sidebar.sleepingWorkspaces.toggle", "Toggle Sleeping Workspaces", "global", []),
  a("sidebar.focusWorktreeList", "Focus worktree list", "global", ["Mod+Shift+0"]),
  a("floatingTerminal.toggle", "Toggle Floating Terminal", "global", ["Mod+Alt+A"]),
  a("floatingWorkspace.maximize", "Maximize Floating Workspace Panel", "global", [], { darwin: ["Mod+Alt+Shift+A"] }),
  a("view.inbox", "Show Inbox", "global", []),
  a("view.floor", "Show Floor", "global", []),
  a("view.code", "Show Code", "global", ["Mod+Shift+3"]),
  a("floatingWorkspace.minimize", "Minimize Floating Workspace Panel", "global", []),
  a("zoom.in", "Zoom In", "global", ["Mod+Equal", "Mod+Shift+Plus", "Mod+NumpadAdd"]),
  a("zoom.out", "Zoom Out", "global", ["Mod+Minus", "Mod+NumpadSubtract"]),
  a("zoom.reset", "Reset Size", "global", ["Mod+0"]),
  a("worktree.history.back", "Worktree History Back", "global", ["Mod+Alt+ArrowLeft"]),
  a("worktree.history.forward", "Worktree History Forward", "global", ["Mod+Alt+ArrowRight"]),
  a("tab.newTerminal", "New terminal tab", "tabs", ["Mod+T"]),
  a("tab.newAgent", "New agent tab (default agent)", "tabs", [], { darwin: ["Mod+Alt+T"] }),
  a("tab.newBrowser", "New browser tab", "tabs", ["Mod+Shift+B"]),
  a("tab.newMarkdown", "New markdown tab", "tabs", ["Mod+Shift+M"]),
  a("tab.openMarkdown", "Open markdown tab", "tabs", ["Mod+Shift+O"]),
  a("tab.close", "Close active tab", "tabs", ["Mod+W"]),
  a("tab.closeAll", "Close all editor tabs", "tabs", ["Mod+Alt+W"]),
  a("tab.rename", "Rename active tab", "tabs", [], { darwin: ["Mod+R"], group: "workspace-shell" }),
  a("tab.reopenClosed", "Reopen closed tab", "tabs", ["Mod+Shift+T"]),
  a("tab.nextSameType", "Next tab (same type)", "tabs", ["Mod+Alt+BracketRight"]),
  a("tab.previousSameType", "Previous tab (same type)", "tabs", ["Mod+Alt+BracketLeft"]),
  a("tab.nextAllTypes", "Next tab (all types)", "tabs", ["Mod+Shift+BracketRight"]),
  a("tab.previousAllTypes", "Previous tab (all types)", "tabs", ["Mod+Shift+BracketLeft"]),
  a("tab.previousRecent", "Previous recent tab", "tabs", ["Ctrl+Tab"]),
  a("tab.nextTerminal", "Next terminal tab", "tabs", ["Ctrl+PageDown"]),
  a("tab.previousTerminal", "Previous terminal tab", "tabs", ["Ctrl+PageUp"]),
  a("tab.selectByIndex", "Select Tab 1–9", "tabs", ["Alt+1"], { darwin: ["Ctrl+1"], index: true }),
  a("browser.find", "Find in Browser", "browser", ["Mod+F"]),
  a("browser.back", "Go Back in Browser", "browser", ["Alt+ArrowLeft"]),
  a("browser.forward", "Go Forward in Browser", "browser", ["Alt+ArrowRight"]),
  a("browser.reload", "Reload Browser Page", "browser", ["Mod+R"]),
  a("browser.hardReload", "Hard Reload Browser Page", "browser", ["Mod+Shift+R"]),
  a("browser.focusAddressBar", "Focus Browser Address Bar", "browser", ["Mod+L"]),
  a("browser.grabElement", "Grab Page Element", "browser", ["Mod+C"]),
  a("editor.find", "Find in editor", "editor", ["Mod+F"]),
  a("editor.replace", "Replace in editor", "editor", ["Mod+H"]),
  a("editor.save", "Save File", "editor", ["Mod+S"]),
  a("editor.markdownPreview", "Show Markdown Preview", "editor", ["Mod+Shift+V"]),
  a("editor.toggleWordWrap", "Toggle Word Wrap", "editor", ["Alt+Z"]),
  a("editor.copyContext", "Copy Context", "editor", ["Mod+Alt+C"]),
  a("editor.previousChange", "Go to Previous Change", "editor", ["Shift+F7"]),
  a("editor.nextChange", "Go to Next Change", "editor", ["F7"]),
  a("editor.addReviewNote", "Add Review Note", "editor", ["Mod+Shift+A"]),
  a("sourceControl.sendReviewNotes", "Send Review Notes to Agent", "editor", [], { group: "editor" }),
  a("fileExplorer.undo", "Undo file operation", "explorer", ["Mod+Z"]),
  a("fileExplorer.redo", "Redo file operation", "explorer", ["Mod+Shift+Z", "Ctrl+Y"]),
  a("fileExplorer.copyPath", "Copy file path", "explorer", ["Alt+Shift+C"]),
  a("fileExplorer.copyRelativePath", "Copy relative file path", "explorer", ["Mod+Alt+Shift+C"]),
  a("fileExplorer.delete", "Delete file", "explorer", ["Delete"]),
  a("settings.search", "Search Settings", "settings", ["Mod+F"]),
  a("terminal.copySelection", "Copy terminal selection", "terminal", ["Ctrl+Shift+C", "Ctrl+C"]),
  a("terminal.selectAll", "Select all terminal text", "terminal", ["Ctrl+Shift+A"]),
  a("terminal.paste", "Paste into terminal", "terminal", ["Ctrl+V", "Ctrl+Shift+V", "Shift+Insert"]),
  a("terminal.search", "Search active pane", "terminal", ["Mod+F"]),
  a("terminal.clear", "Clear active pane", "terminal", ["Mod+K"]),
  a("terminal.focusNextPane", "Focus next pane", "terminal", ["Mod+BracketRight"]),
  a("terminal.focusPreviousPane", "Focus previous pane", "terminal", ["Mod+BracketLeft"]),
  a("terminal.equalizePaneSizes", "Equalize pane sizes", "terminal", []),
  a("terminal.expandPane", "Expand / collapse pane", "terminal", ["Mod+Shift+Enter"]),
  a("terminal.setTitle", "Set Title…", "terminal", []),
  a("terminal.clearPaneTitle", "Clear Pane Title", "terminal", []),
  a("terminal.closePane", "Close active pane", "terminal", ["Mod+W"]),
  a("terminal.splitRight", "Split terminal right", "terminal", ["Mod+Shift+D"], { darwin: ["Mod+D"] }),
  a("terminal.splitDown", "Split terminal down", "terminal", ["Alt+Shift+D"], { darwin: ["Mod+Shift+D"] }),
  a("terminal.switchInputSource", "Switch input source / language (native)", "terminal", []),
  a("view.cycleWorkspaceView", "Cycle Workspace View (Agents / Board / Terminals)", "global", ["Mod+Alt+V"]),
  a("sessions.add", "Add a Session", "global", []),
  a("sessions.remove", "Remove a Session", "global", []),
  a("terminals.focusNextNeedsYou", "Next That Needs You", "global", ["Mod+J"], { darwin: ["Mod+Shift+J"] }),
  ...agents.map(([id, name]) => a(`tab.newAgent.${id}`, `New ${name} tab`, "tabs", [])),
];

export const actionById: ReadonlyMap<string, Action> = new Map(actions.map((x) => [x.id, x]));

/** The built-in chords for one platform. */
export function defaultsFor(action: Action, platform: Platform): string[] {
  return platform === "darwin" && action.darwin ? action.darwin : action.win32;
}
