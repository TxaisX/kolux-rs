// Settings > Terminal & sessions. TERM-045: whether closing a tab with a live program asks first.
// TERM-005: how many panes a new workspace starts with.
import { CONFIRM_CLOSE_FIELD, asksBeforeClose } from "../terminal/closing";
import { PIN_ASK_FIELD, pinAsks } from "../terminal/pin";
import { REMOVE_FIELD, readRemove } from "../terminal/remove";
import { DEFAULT_PANES_FIELD, PANE_COUNTS, seedCount } from "../terminal/grid";
import { Segmented } from "./GeneralPage";
import { readLook } from "./general";
import { useSettings } from "./useSettings";

export default function TerminalPage() {
  const { settings, error, save } = useSettings();
  return (
    <>
      {error && <p className="conn-detail warn">{error}</p>}
      {settings && (
        <section className="conn-card" data-section="panes">
          <h2 className="conn-name">New workspaces start with</h2>
          <Segmented
            label="New workspaces start with"
            options={PANE_COUNTS.map((n) => ({ id: String(n), label: n === 1 ? "1 pane" : `${n} panes` }))}
            value={String(seedCount(settings[DEFAULT_PANES_FIELD], false))}
            onPick={(v) => save({ [DEFAULT_PANES_FIELD]: Number(v) })}
          />
          <p className="conn-detail">{readLook(settings) === "classic" ? "The classic look always starts with one pane." : "The first pane is a terminal; the others wait for you to pick what runs in them."}</p>
        </section>
      )}
      {settings && (
        <section className="conn-card" data-section="closing">
          <h2 className="conn-name">Closing tabs</h2>
          <label className="conn-switch">
            <input type="checkbox" role="switch" checked={asksBeforeClose(settings)} onChange={(e) => save({ [CONFIRM_CLOSE_FIELD]: e.target.checked })} />
            Ask before closing a tab that is running a program
          </label>
          <p className="conn-detail">An idle shell always closes straight away.</p>
          <label className="conn-switch">
            <input type="checkbox" role="switch" checked={pinAsks(settings)} onChange={(e) => save({ [PIN_ASK_FIELD]: e.target.checked })} />
            Ask before closing a pinned tab
          </label>
          <p className="conn-detail">Pinned tabs sit first in the strip and stay out of Close others, Close all and middle-click.</p>
          <h2 className="conn-name">Removing a started session</h2>
          <Segmented
            label="Removing a started session"
            options={[
              { id: "ask", label: "Ask first" },
              { id: "stop", label: "Stop without asking" },
            ]}
            value={readRemove(settings)}
            onPick={(v) => save({ [REMOVE_FIELD]: v })}
          />
          <p className="conn-detail">Applies to Remove session on a running agent or a busy shell. A pane that has not started, or an idle shell, is removed straight away.</p>
        </section>
      )}
    </>
  );
}
