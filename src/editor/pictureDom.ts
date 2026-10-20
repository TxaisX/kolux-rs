// EDIT-009 (T-234-b): the page-side glue for local pictures in a rendered note: the app's invoke, an
// IntersectionObserver so only pictures near the view are read, and a plain line where one cannot be shown.
// The rules live in pictureBytes.ts and imageFiles.ts, which are tested without a page.
import { invoke } from "@tauri-apps/api/core";
import { showLocalPictures, type Imgs, type Watch } from "./pictureBytes";

/** Calls `show` once when the element comes within ~1200px of the view (at once without an observer). */
const watchVisible: Watch = (el, show) => {
  if (typeof IntersectionObserver === "undefined") {
    show();
    return () => {};
  }
  const seen = new IntersectionObserver(
    (hits) => {
      if (!hits.some((h) => h.isIntersecting)) return;
      seen.disconnect();
      show();
    },
    { rootMargin: "1200px" },
  );
  seen.observe(el as unknown as Element);
  return () => seen.disconnect();
};

const line = (text: string) => {
  const s = document.createElement("span");
  s.className = "md-picture-skipped";
  s.textContent = text;
  return s;
};

/** Shows the local pictures among `root`'s images (read through the fence, a few at a time as they scroll in); call the result to let go. */
export function showPicturesIn(root: HTMLElement, notePath: string): () => void {
  const imgs = [...root.querySelectorAll("img")] as unknown as Imgs[];
  return showLocalPictures(imgs, notePath, invoke, watchVisible, (b) => URL.createObjectURL(b), (u) => URL.revokeObjectURL(u), line);
}
