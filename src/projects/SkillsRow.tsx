// SKILL-018: the sidebar Skills button, hidden on a fresh install. Settings > Appearance turns it on
// (the Skills settings section is cut, SKILL-019); right-click hides it again.
import { Book } from "../chrome/icons";
import HideableRow from "./HideableRow";

type Props = { open: boolean; onOpen: () => void; onHide: () => void };

export default function SkillsRow(p: Props) {
  return <HideableRow {...p} label="Skills" icon={<Book />} hideText="Hide Skills button" />;
}
