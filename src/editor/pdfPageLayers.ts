// EDIT-029 (T-235-b): the two layers laid over a PDF page's canvas. The text layer holds the page's words as invisible
// text so they can be selected and copied; the annotation layer holds the links and notes. Everything here runs on the
// installed pdf.js and nothing is fetched or executed: no form fields, no embedded scripts, no download manager.
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";
import { resolveLink, type Action } from "./noteLinks";

type Lib = typeof import("pdfjs-dist");
type LinkServiceArg = Parameters<InstanceType<Lib["AnnotationLayer"]>["render"]>[0]["linkService"];

/** What the annotation layer is asked for. Forms and scripts stay off; the icon path is a data address, so no icon is ever requested. */
export const ANNOTATION_OPTIONS = { renderForms: false, enableScripting: false, hasJSActions: false, imageResourcesPath: "data:," } as const;

/** A link inside a PDF that goes to a web address, by the app's own link rules; mail, file, script and every other address give null. */
export function webLink(url: string, file: string, root: string | null): Extract<Action, { kind: "web" }> | null {
  const a = resolveLink(url, file, root);
  return a.kind === "web" ? a : null;
}

/** Where a destination lands: the page (1-based) and the height on it counted from the page bottom (null = the top), or null when it names nothing. */
export async function destinationSpot(doc: Pick<PDFDocumentProxy, "getDestination" | "getPageIndex">, dest: unknown): Promise<{ page: number; top: number | null } | null> {
  try {
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || !explicit.length) return null;
    const [where, mode, a, b] = explicit as [unknown, { name?: string } | null, unknown, unknown];
    const index = typeof where === "number" ? where : where && typeof where === "object" ? await doc.getPageIndex(where as Parameters<typeof doc.getPageIndex>[0]) : NaN;
    if (!Number.isInteger(index) || index < 0) return null;
    const at = mode?.name === "XYZ" ? b : mode?.name === "FitH" || mode?.name === "FitBH" ? a : null;
    return { page: index + 1, top: typeof at === "number" && Number.isFinite(at) ? at : null };
  } catch {
    return null; // a name or reference the file does not have
  }
}

/** How far down the page (0 to 1) a destination height, counted from the page bottom, sits. */
export function spotOffset(top: number | null, pageHeight: number): number {
  if (top === null || !Number.isFinite(top) || !(pageHeight > 0)) return 0;
  return Math.min(1, Math.max(0, 1 - top / pageHeight));
}

/** What the viewer lends the link service. */
export type LinkHost = {
  pages(): number;
  current(): number;
  follow(url: string, shift: boolean): void;
  goTo(dest: string | unknown[]): void | Promise<void>;
  goToPage(page: number): void;
};

/** pdf.js asks its links to be bound through this; the answers keep every click inside the viewer. */
export function makeLinkService(host: LinkHost) {
  const go = (n: number) => host.goToPage(Math.min(Math.max(1, n), Math.max(1, host.pages())));
  return {
    get pagesCount() {
      return host.pages();
    },
    page: 1,
    rotation: 0,
    isInPresentationMode: false,
    externalLinkEnabled: true,
    async goToDestination(dest: string | unknown[]) {
      await host.goTo(dest);
    },
    goToPage(v: number | string) {
      const n = Number(v);
      if (Number.isInteger(n)) go(n);
    },
    goToXY(page: number) {
      go(page);
    },
    // No address goes on the element: a click is handled here, and a middle-click or drag has nothing to open.
    addLinkAttributes(link: HTMLAnchorElement, url: string) {
      link.title = url;
      link.setAttribute("role", "link");
      link.tabIndex = 0;
      link.onclick = (e) => {
        e.preventDefault();
        host.follow(url, e.shiftKey);
        return false;
      };
      link.onkeydown = (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        host.follow(url, e.shiftKey);
      };
    },
    getDestinationHash: () => "",
    getAnchorUrl: () => "",
    setHash() {},
    executeNamedAction(action: string) {
      const here = host.current();
      if (action === "NextPage") go(here + 1);
      else if (action === "PrevPage") go(here - 1);
      else if (action === "FirstPage") go(1);
      else if (action === "LastPage") go(host.pages());
    },
    executeSetOCGState() {},
  } as unknown as LinkServiceArg;
}

/**
 * Fills a page's two layers. `text` and `notes` are empty positioned boxes over the canvas inside an element that
 * carries the page's scale as --total-scale-factor. Returns what stops the work when the page is let go.
 */
export function drawPageLayers(lib: Lib, page: PDFPageProxy, view: PageViewport, text: HTMLDivElement, notes: HTMLDivElement, links: LinkServiceArg): () => void {
  let live = true;
  text.replaceChildren();
  notes.replaceChildren();
  const words = new lib.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport: view });
  words
    .render()
    .then(() => {
      if (!live) return;
      // the strip that keeps a drag across gaps between words selecting, instead of jumping to the end of the page
      const end = document.createElement("div");
      end.className = "endOfContent";
      text.append(end);
    })
    .catch(() => undefined); // a cancelled layer rejects; nothing to say
  text.onpointerdown = () => {
    text.classList.add("selecting");
    window.addEventListener("pointerup", () => text.classList.remove("selecting"), { once: true });
  };
  void page
    .getAnnotations({ intent: "display" })
    .then(async (annotations) => {
      if (!live || !annotations.length) return;
      const flat = view.clone({ dontFlip: true });
      const layer = new lib.AnnotationLayer({ div: notes, accessibilityManager: null, annotationCanvasMap: null, annotationEditorUIManager: null, page, viewport: flat, structTreeLayer: null, commentManager: null, linkService: links, annotationStorage: null });
      await layer.render({ ...ANNOTATION_OPTIONS, annotations, div: notes, viewport: flat, page, linkService: links });
    })
    .catch(() => undefined);
  return () => {
    live = false;
    words.cancel();
    text.onpointerdown = null;
  };
}
