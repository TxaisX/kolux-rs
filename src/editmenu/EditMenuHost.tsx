// APP-014: the right-click menu of text fields, mounted once. A right-click outside editable text gets no
// menu at all. Inside a field the rows come from editMenuModel.ts; on Windows the engine also reports its
// spelling suggestions (edit_menu.rs), which sit at the top. Elsewhere the menu carries the edit rows only
// (no suggestions on macOS or Linux: the web view gives the page no way to ask for them).
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { detectPlatform } from "../keys/keymap";
import { fitIn, outsideDismisses } from "../terminal/PaneMenu";
import { editMenuItems, fieldKind, type EditAction, type EditItem, type FieldLike } from "./editMenuModel";

const SUGGESTIONS_EVENT = "edit-menu-suggestions";
/** How long the page waits for the engine's suggestions before drawing the menu without them. */
const SUGGESTION_WAIT_MS = 300;

type Box = HTMLInputElement | HTMLTextAreaElement;
const isBox = (el: Element): el is Box => el.tagName === "INPUT" || el.tagName === "TEXTAREA";

export function describeField(el: Element | null): FieldLike | null {
  if (!el) return null;
  const box = isBox(el) ? el : null;
  return {
    tag: el.tagName,
    type: box && el.tagName === "INPUT" ? (box as HTMLInputElement).type : undefined,
    readOnly: box?.readOnly,
    disabled: box?.disabled,
    contentEditable: (el as HTMLElement).isContentEditable,
    inTerminal: !!el.closest(".xterm"),
  };
}

function hasSelection(el: Element): boolean {
  if (isBox(el)) return el.selectionStart !== el.selectionEnd;
  return (window.getSelection()?.toString() ?? "") !== "";
}

/** Runs one row on the field; focus goes back first so the browser's edit commands act on it. */
export function runEdit(el: HTMLElement, action: EditAction): void {
  el.focus();
  switch (action.kind) {
    case "suggest":
      document.execCommand("insertText", false, action.word);
      break;
    case "cut":
    case "copy":
      document.execCommand(action.kind);
      break;
    case "selectAll":
      if (isBox(el)) el.select();
      else document.execCommand("selectAll");
      break;
    case "paste":
      navigator.clipboard
        .readText()
        .then((t) => {
          if (t) document.execCommand("insertText", false, t);
        })
        .catch(() => {});
      break;
  }
}

type Open = { x: number; y: number; items: EditItem[]; target: HTMLElement };

export default function EditMenuHost() {
  const [menu, setMenu] = useState<Open | null>(null);
  useEffect(() => {
    const platform = detectPlatform();
    let hooked = false;
    invoke<boolean>("edit_menu_suggestions_available")
      .then((v) => (hooked = v))
      .catch(() => {});
    let waiting: ((words: string[]) => void) | null = null;
    const un = listen<{ words: string[] }>(SUGGESTIONS_EVENT, (e) => waiting?.(e.payload.words ?? []));
    const onContext = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const kind = fieldKind(describeField(target));
      if (!target || kind === "none") {
        e.preventDefault();
        return;
      }
      const { clientX: x, clientY: y } = e;
      const show = (suggestions: string[]) => {
        waiting = null;
        setMenu({ x, y, target, items: editMenuItems({ kind, hasSelection: hasSelection(target), suggestions, platform }) });
      };
      // Left alone, the engine raises its own event (which carries the suggestions) and draws no menu of its own.
      if (hooked && kind === "editable") {
        const timer = window.setTimeout(() => show([]), SUGGESTION_WAIT_MS);
        waiting = (words) => (window.clearTimeout(timer), show(words));
      } else {
        e.preventDefault();
        show([]);
      }
    };
    document.addEventListener("contextmenu", onContext);
    return () => {
      document.removeEventListener("contextmenu", onContext);
      void un.then((f) => f());
    };
  }, []);
  return menu && <Menu menu={menu} onDismiss={() => setMenu(null)} />;
}

function Menu({ menu, onDismiss }: { menu: Open; onDismiss: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const openedAt = useRef(performance.now());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onDismiss();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDismiss]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.top = `${fitIn(r.top, r.height, window.innerHeight)}px`;
    el.style.left = `${fitIn(r.left, r.width, window.innerWidth)}px`;
  }, [menu.items.length]);
  const outside = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (outsideDismisses(openedAt.current, performance.now())) onDismiss();
  };
  const { items } = menu;
  return (
    <>
      <div className="menu-backdrop" onClick={outside} onContextMenu={outside} aria-hidden="true" />
      <div ref={box} className="menu edit-menu" role="menu" aria-label="Text menu" style={{ top: menu.y, left: menu.x }}>
        {items.map((it, i) => (
          <Fragment key={it.id}>
            {i > 0 && items[i - 1].group !== it.group && <div role="separator" style={{ height: 1, margin: "4px 6px", background: "var(--line-strong)" }} />}
            <button
              role="menuitem"
              className="menu-item"
              disabled={it.disabled}
              // Keep the field's focus and selection while the row is pressed.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (onDismiss(), runEdit(menu.target, it.action))}
            >
              <span className="name">{it.name}</span>
              {it.shortcut && <span className="muted">{it.shortcut}</span>}
            </button>
          </Fragment>
        ))}
      </div>
    </>
  );
}
