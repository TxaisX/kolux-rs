// GIT-041: the review notes section of Source Control. Every note of the workspace, by file; each
// opens at its line, copies or goes; a file's notes or all of them clear at once; Send pastes them
// into the workspace's agent as one message and marks them sent.
import { useState } from "react";
import { Close, Trash } from "../chrome/icons";
import { lineLabel, noteBlocks, notesByFile, shortPath, type LineNote } from "../editor/diffNotes";
import { emptyNotesHint } from "../editor/fileNotes";
import { useLabel } from "../keys/KeymapContext";

type Props = {
  dir: string;
  notes: LineNote[];
  onOpen: (n: LineNote) => void;
  onDrop: (ids: string[]) => void;
  onClearSent: () => void;
  /** Sends every note; the promise gives the reason when nothing was sent. */
  onSend: () => Promise<string | null>;
  /** GIT-041: the workspace's folder is not a Git repository, so notes sit on a file's lines. */
  repoless?: boolean;
};

export default function LineNotes({ dir, notes, onOpen, onDrop: drop, onClearSent, onSend, repoless = false }: Props) {
  const addKey = useLabel("editor.addReviewNote").join("+");
  const [open, setOpen] = useState(true);
  const [sending, setSending] = useState(false);
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  // The last message is about notes that may be gone once some are cleared.
  const onDrop = (ids: string[]) => {
    setSaid(null);
    drop(ids);
  };
  const copy = (ns: LineNote[]) =>
    navigator.clipboard.writeText(noteBlocks(ns, dir)).then(
      () => setSaid({ text: ns.length === 1 ? "Note copied." : `${ns.length} notes copied.`, bad: false }),
      () => setSaid({ text: "The notes could not be copied here.", bad: true }),
    );
  const send = async () => {
    setSending(true);
    setSaid(null);
    const why = await onSend();
    setSending(false);
    setSaid(why ? { text: why, bad: true } : { text: `${notes.length === 1 ? "The note was" : `${notes.length} notes were`} sent to the agent.`, bad: false });
  };
  const sent = notes.filter((n) => n.sent).length;
  return (
    <details className="scm-history scm-notes" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <span>Review notes</span>
        {notes.length > 0 && <span className="count">{notes.length}</span>}
      </summary>
      {notes.length === 0 ? (
        <div className="sb-hint">{emptyNotesHint(repoless, addKey)}</div>
      ) : (
        <>
          <div className="btn-row">
            <button className="btn primary" disabled={sending} onClick={() => void send()}>
              {sending ? "Sending…" : "Send to agent"}
            </button>
            <button className="btn" onClick={() => void copy(notes)}>
              Copy all
            </button>
            {sent > 0 && (
              <button className="btn" onClick={() => { setSaid(null); onClearSent(); }} title="Remove the notes the agent already has">
                Clear sent
              </button>
            )}
            <button className="btn" onClick={() => onDrop(notes.map((n) => n.id))}>
              Clear all
            </button>
          </div>
          {notesByFile(notes).map(([path, ns]) => (
            <div key={path} className="scm-note-file">
              <div className="scm-note-path">
                <span className="name" title={path}>
                  {shortPath(path, dir)}
                </span>
                <button className="ib" title={`Clear the notes on ${shortPath(path, dir)}`} aria-label={`Clear notes on ${shortPath(path, dir)}`} onClick={() => onDrop(ns.map((n) => n.id))}>
                  <Close />
                </button>
              </div>
              {ns.map((n) => (
                <div key={n.id} className="scm-note" data-note={n.id}>
                  <button className="scm-note-open" title={repoless ? "Open the file at this note" : "Open the diff at this note"} onClick={() => onOpen(n)}>
                    <span className="line">{lineLabel(n)}</span>
                    <span className="text">{n.text}</span>
                    {n.sent && <span className="sent">sent</span>}
                  </button>
                  <button className="ib" title="Copy this note" onClick={() => void copy([n])}>
                    Copy
                  </button>
                  <button className="ib" title="Delete this note" aria-label="Delete note" onClick={() => onDrop([n.id])}>
                    <Trash size={13} />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
      {said && <div className={said.bad ? "note error" : "note"}>{said.text}</div>}
    </details>
  );
}
