// SET-015 (T-246-d): the first time this build reads the keybindings file, an install that already had a
// file keeps the tab-stepping pairing it was used to (tabKeysUpgrade.ts says which keys), written into the
// file once. A brand new install (the file was just created) keeps the new defaults. A saved marker in the
// settings makes sure this runs once; a file that already names any of the four commands is never touched.
import { OLD_PAIRING, seedOldTabPairing, TAB_STEP_IDS } from "./tabKeysUpgrade";

export const SEEDED_FIELD = "tabKeysSeeded";

export type SeedIo = {
  settings: () => Promise<Record<string, unknown>>;
  /** Saves the marker. */
  mark: () => Promise<unknown>;
  /** Writes one command's chords into the file (the keymap's own save). */
  write: (id: string, chords: string[]) => Promise<unknown>;
};
type FileRead = { value: unknown; created: boolean; error: string | null };

/** True when the old pairing was written. A file that could not be read is retried at the next start. */
export async function seedFirstLoad(file: FileRead, io: SeedIo): Promise<boolean> {
  if (file.error) return false;
  const s = await io.settings();
  if (s[SEEDED_FIELD] === true) return false;
  const seeded = seedOldTabPairing(file.value, !file.created) !== null;
  if (seeded) for (const id of TAB_STEP_IDS) await io.write(id, OLD_PAIRING[id]);
  await io.mark();
  return seeded;
}
