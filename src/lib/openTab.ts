/**
 * Open a same-site page in a new tab and report whether it opened.
 *
 * `window.open(url, '_blank', 'noopener')` always returns null (HTML spec), so
 * a check on its result reported "Popup blocked" even when the tab opened.
 * Open without noopener, then cut the link back to this page by hand.
 */
export function openInNewTab(href: string, win: Pick<Window, 'open'> = window): boolean {
  const opened = win.open(href, '_blank');
  if (!opened) return false;
  try { opened.opener = null; } catch { /* the tab is open either way */ }
  return true;
}
