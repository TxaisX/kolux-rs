// Settings > Terminal & sessions. TERM-045: whether closing a tab with a live program asks first.
import { CONFIRM_CLOSE_FIELD, asksBeforeClose } from "../terminal/closing";
import { useSettings } from "./useSettings";

export default function TerminalPage() {
  const { settings, error, save } = useSettings();
  return (
    <>
      {error && <p className="conn-detail warn">{error}</p>}
      {settings && (
        <section className="conn-card" data-section="closing">
          <h2 className="conn-name">Closing tabs</h2>
          <label className="conn-switch">
            <input type="checkbox" role="switch" checked={asksBeforeClose(settings)} onChange={(e) => save({ [CONFIRM_CLOSE_FIELD]: e.target.checked })} />
            Ask before closing a tab that is running a program
          </label>
          <p className="conn-detail">An idle shell always closes straight away.</p>
        </section>
      )}
    </>
  );
}
