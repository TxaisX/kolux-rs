// STAT-039 (T-110-b): the folder-rename question after the first work renamed a branch. One
// question at a time; Keep the folder leaves everything as it is. A move Git refuses (a terminal or
// agent still holds the folder on Windows, the place is taken) is shown in full and nothing changes.
import { useState } from "react";
import Ask from "../chrome/Ask";
import { lastPart, moveFolder, useFolderOffers } from "./folderRename";

export default function FolderRenameAsk({ onMoved }: { onMoved: (from: string, to: string) => void }) {
  const { offer, dismiss } = useFolderOffers();
  const [error, setError] = useState<{ dir: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!offer) return null;
  if (error && error.dir === offer.dir) {
    return (
      <Ask
        title="The folder kept its name"
        body={`Git could not move the folder: ${error.text} A terminal or agent still working in it holds the folder; close them and the branch's name stays ready for it.`}
        confirm={null}
        onConfirm={() => (setError(null), dismiss(offer.dir))}
        onCancel={() => (setError(null), dismiss(offer.dir))}
      />
    );
  }
  return (
    <Ask
      title="Rename the folder too?"
      body={`The branch is now "${offer.name}". Rename its folder from ${lastPart(offer.dir)} to ${offer.folder} as well? Nothing in it is removed; a terminal or agent working in it may hold the folder, and Git says so if it does.`}
      confirm={busy ? "Renaming…" : "Rename folder"}
      cancel="Keep the folder"
      safe
      onCancel={() => dismiss(offer.dir)}
      onConfirm={() => {
        if (busy) return;
        setBusy(true);
        moveFolder(offer.dir, offer.folder)
          .then((to) => {
            onMoved(offer.dir, to);
            dismiss(offer.dir);
          })
          .catch((err) => setError({ dir: offer.dir, text: String(err) }))
          .finally(() => setBusy(false));
      }}
    />
  );
}
