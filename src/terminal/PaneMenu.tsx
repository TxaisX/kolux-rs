// The pane menu (TERM-025): the header's "..." button and a right-click on the header open it.
// It holds what a pane can do today: expand or restore (TERM-013), split, close. Later cards add
// their items here (Set Title, Equalize, Clear Screen, copy ids).
import type { CSSProperties, ReactNode } from "react";
import { KeyText } from "../keys/KeymapContext";

type Props = {
  style: CSSProperties;
  expanded: boolean;
  /** False for a lone pane in the classic look (TERM-025). */
  canExpand: boolean;
  onExpand?: () => void;
  onSplit?: (dir: "right" | "down") => void;
  onClose: () => void;
  onDismiss: () => void;
  /** TERM-027: the title and copy-id items the pane adds after these. */
  children?: ReactNode;
};

export default function PaneMenu({ style, expanded, canExpand, onExpand, onSplit, onClose, onDismiss, children }: Props) {
  const item = (name: string, key: string, run: (() => void) | undefined, disabled = false) => (
    <button
      role="menuitem"
      className="menu-item"
      disabled={disabled || !run}
      onClick={() => {
        onDismiss();
        run?.();
      }}
    >
      <span className="name">{name}</span>
      <span className="muted">
        <KeyText id={key} />
      </span>
    </button>
  );
  return (
    <>
      <div className="menu-backdrop" onClick={onDismiss} onContextMenu={(e) => (e.preventDefault(), onDismiss())} aria-hidden="true" />
      <div className="menu pane-menu" role="menu" aria-label="Pane menu" style={style} onKeyDown={(e) => e.key === "Escape" && onDismiss()}>
        {item(expanded ? "Restore pane" : "Expand pane", "terminal.expandPane", onExpand, !canExpand)}
        {item("Split right", "terminal.splitRight", onSplit && (() => onSplit("right")))}
        {item("Split down", "terminal.splitDown", onSplit && (() => onSplit("down")))}
        {item("Close pane", "terminal.closePane", onClose)}
        {children}
      </div>
    </>
  );
}
