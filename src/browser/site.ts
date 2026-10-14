// BROW-023: a tab's site icon belongs to the site, so it stays while the tab moves within one
// site and goes when the tab goes to another; an answer for an old site is ignored.
export type SiteIcon = { site: string; src: string } | null;

export function siteOf(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : "";
  } catch {
    return "";
  }
}

/** The icon to show once the tab is at `url`. */
export const iconAt = (icon: SiteIcon, url: string): SiteIcon => (icon && icon.site === siteOf(url) ? icon : null);

/** The icon after the back end found `src` for the page `page` while the tab is at `url`. */
export function iconFound(icon: SiteIcon, url: string, page: string, src: string): SiteIcon {
  const site = siteOf(page);
  return site && site === siteOf(url) ? { site, src } : icon;
}
