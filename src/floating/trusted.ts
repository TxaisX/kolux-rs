// T-271 (SAFE-027): the floating workspace opens only in folders the user picked. Rust keeps the
// trusted list (floating_trust.rs) and decides where a floating terminal or agent starts; the only
// way a folder joins the list is the system folder picker Rust shows. Nothing here ever sends a
// list of folders, so a list from the interface cannot become trusted. Every failure opens nothing.

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export type Start = { cwd: string } | { refused: string };

export const NOT_PICKED = "No folder picked: the floating workspace opens only in a folder you choose.";

/**
 * Where a new floating terminal or agent starts. Rust answers with a trusted folder (the asked one,
 * or the most recent pick); with none trusted yet, the system folder picker is offered once and the
 * folder chosen there is used. An asked folder that is refused is never replaced by a picker, and a
 * cancelled picker or any error opens nothing.
 */
export async function startFolderFor(call: Invoke, asked: string | null = null): Promise<Start> {
  try {
    return { cwd: await call<string>("floating_start", { asked }) };
  } catch (e) {
    if (asked) return { refused: String(e) };
    let chosen: string | null;
    try {
      chosen = await call<string | null>("floating_pick");
    } catch (err) {
      return { refused: String(err) };
    }
    return chosen ? { cwd: chosen } : { refused: NOT_PICKED };
  }
}
