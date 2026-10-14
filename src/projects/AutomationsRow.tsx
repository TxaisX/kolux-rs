// AUTO-023: the Automations row in the sidebar nav. One setting (`automationsButton`) drives it and
// the switch in Settings > Appearance; right-click offers to hide the row again.
import { Clock } from "../chrome/icons";
import HideableRow from "./HideableRow";

type Props = { open: boolean; onOpen: () => void; onHide: () => void };

export default function AutomationsRow(p: Props) {
  return <HideableRow {...p} label="Automations" icon={<Clock />} hideText="Hide Automations row" />;
}
