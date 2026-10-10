// Settings > Git & worktrees. PROJ-070: whether deleting one clean workspace asks first.
import { CONFIRM_DELETE_FIELD, asksBeforeDelete } from "../projects/deleting";
import { useSettings } from "./useSettings";

export default function GitPage() {
  const { settings, error, save } = useSettings();
  return (
    <>
      {error && <p className="conn-detail warn">{error}</p>}
      {settings && (
        <section className="conn-card" data-section="deleting">
          <h2 className="conn-name">Deleting workspaces</h2>
          <label className="conn-switch">
            <input type="checkbox" role="switch" checked={asksBeforeDelete(settings)} onChange={(e) => save({ [CONFIRM_DELETE_FIELD]: e.target.checked })} />
            Ask before deleting a workspace
          </label>
          <p className="conn-detail">With this off, a workspace with nothing uncommitted is deleted at once. One with changes, a lock or another workspace inside it always asks.</p>
        </section>
      )}
    </>
  );
}
