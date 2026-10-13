// AUTO-023: the Automations row in the sidebar nav. One setting (`automationsButton`) drives it and
// the switch in Settings > Appearance; right-click offers to hide the row again.
import { useState } from "react";
import { Clock } from "../chrome/icons";

type Props = { open: boolean; onOpen: () => void; onHide: () => void };

export default function AutomationsRow({ open, onOpen, onHide }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const shut = () => setMenu(null);
  return (
    <>
      <button
        className={`row${open ? " on" : ""}`}
        aria-current={open ? "page" : undefined}
        onClick={onOpen}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <span className="ic">
          <Clock />
        </span>
        Automations
      </button>
      {menu && (
        <>
          <div
            className="menu-backdrop"
            onClick={shut}
            onContextMenu={(e) => {
              e.preventDefault();
              shut();
            }}
          />
          <div className="menu" role="menu" style={{ left: menu.x, top: menu.y }} onKeyDown={(e) => e.key === "Escape" && shut()}>
            <button
              className="menu-item"
              role="menuitem"
              autoFocus
              onClick={() => {
                shut();
                onHide();
              }}
            >
              <span className="name">Hide Automations row</span>
            </button>
          </div>
        </>
      )}
    </>
  );
}
