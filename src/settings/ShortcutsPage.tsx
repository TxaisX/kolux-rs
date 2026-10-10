// Settings > Shortcuts: where the shortcuts file lives, what it got wrong, and every command with
// its keys. Editing a binding here, and the terminal's shortcut policy, come with SET-014.
import { actions } from "../keys/actions";
import { KeyText, useKeymap } from "../keys/KeymapContext";

export default function ShortcutsPage() {
  const keymap = useKeymap();
  return (
    <>
      <section className="conn-card" data-section="shortcuts-file">
        <h2 className="conn-name">Shortcuts file</h2>
        <p className="conn-detail">{keymap.path ?? "Reading where the file is..."}</p>
        {keymap.errors.map((e, i) => (
          <p key={i} className="conn-detail warn">
            {e}
          </p>
        ))}
        <div className="btn-row">
          <button className="btn" onClick={keymap.reload}>
            Read the file again
          </button>
        </div>
      </section>
      <section className="conn-card" data-section="key-bindings">
        <h2 className="conn-name">Commands and keys</h2>
        <table className="keys-table">
          <tbody>
            {actions.map((a) => (
              <tr key={a.id}>
                <td>{a.title}</td>
                <td>
                  <KeyText id={a.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
