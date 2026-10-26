// T-240 (BROW-035): the steps of grabbing a page element, apart from the screen: pick -> stop the picker
// -> take the page's picture -> cut the element out -> (details sheet) copy or send. `invoke` and the
// canvas cut are passed in so a test fakes them; the sheet (GrabSheet.tsx) and BrowserPane only call these.
import type { Pick } from "./annotate";
import { cropRect, detailRows, detailsText, grabMessage, type Row } from "./grab";
import { asDataUrl, capturePage, type Picture, sendPicture } from "./picture";

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type OnSend = ((key: number, text: string) => Promise<void> | void) | undefined;

/** What the details sheet shows: the pick, its rows, the element's cropped picture (PNG data URL) and why there is none. */
export type Grab = { pick: Pick; rows: Row[]; picture: string | null; problem: string | null };

/** Cuts the element's box out of the page picture into a PNG data URL, on a canvas. The picture's own pixel
 * size comes from the decoded image (a high-density screen makes it larger than the CSS size).
 * `null` when the element is off the picture or has no size. */
export async function cropOnCanvas(shot: Picture, box: NonNullable<Pick["box"]>): Promise<string | null> {
  const img = new Image();
  await new Promise<void>((ok, bad) => {
    img.onload = () => ok();
    img.onerror = () => bad(new Error("The page's picture could not be read"));
    img.src = asDataUrl(shot);
  });
  const crop = cropRect(box, img.naturalWidth, img.naturalHeight, shot.cssWidth, shot.cssHeight);
  if (!crop) return null;
  const out = document.createElement("canvas");
  out.width = crop.dw;
  out.height = crop.dh;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("No canvas to cut the picture on");
  ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.dw, crop.dh);
  return out.toDataURL("image/png");
}

/** A pick was made in grab mode: the picker stops first (its outline would be in the picture), then the
 * page's picture is taken and the element cut out. A page that gives no picture, or an element off the
 * screen, still opens the sheet with the details, and says why there is no picture. */
export async function grabElement(invoke: Invoke, id: number, pick: Pick, cut: (shot: Picture, box: NonNullable<Pick["box"]>) => Promise<string | null> = cropOnCanvas): Promise<Grab> {
  const grab: Grab = { pick, rows: detailRows(pick), picture: null, problem: null };
  await invoke("browser_annotate", { id, what: "stop" }).catch(() => {});
  try {
    const shot = await capturePage(invoke, id);
    if (!pick.box) grab.problem = "The page gave no size for this element, so there is no picture";
    else {
      grab.picture = await cut(shot, pick.box);
      if (!grab.picture) grab.problem = "The element is outside the visible page, so there is no picture";
    }
  } catch (err) {
    grab.problem = err instanceof Error ? err.message : String(err);
  }
  return grab;
}

/** Copy details: the rows as plain text on the clipboard. Resolves to the line for the sheet. */
export async function copyDetails(write: (text: string) => Promise<void>, pick: Pick): Promise<string> {
  try {
    await write(detailsText(pick));
    return "Details copied";
  } catch {
    return "Copy was refused; the details are selectable on the sheet";
  }
}

/** Send to agent `key`: the cropped picture is saved and its path goes into the message with the details;
 * without a picture the details go alone. Failures reach the caller; nothing is sent after a failed save. */
export async function sendGrab(invoke: Invoke, onSend: OnSend, key: number, g: Grab, title: string, url: string): Promise<string> {
  const name = `${title || "page"} element`;
  if (g.picture) {
    await sendPicture(invoke, onSend, key, { dataUrl: g.picture, name, text: (path) => grabMessage(g.pick, title, url, path) });
  } else {
    if (!onSend) throw new Error("No agent sessions in this worktree");
    await onSend(key, grabMessage(g.pick, title, url, null));
  }
  return `Element sent (${g.pick.selector || g.pick.tag || "element"})`;
}

/** Esc leaves grab mode. */
export const leavesGrab = (key: string): boolean => key === "Escape";
