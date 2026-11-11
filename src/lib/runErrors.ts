import { friendlyError } from './userMessages';

/**
 * A load or send failure in plain words. A message the app knows (offline,
 * the database is down, a save failed) keeps its own sentence; anything else
 * the server said ("boom", a stack line) becomes one plain sentence, and the
 * raw text is kept apart for a "Details" fold, for support.
 */
export function plainServerError(error: unknown, plain = 'Something went wrong on our side. Try again in a minute.'): { text: string; details: string } {
  const raw = (error instanceof Error ? error.message : typeof error === 'string' ? error : '').trim();
  const friendly = friendlyError(error instanceof Error ? error : new Error(raw), plain);
  // friendlyError hands back the raw text when it doesn't know it.
  if (!raw || friendly === plain) return { text: plain, details: '' };
  if (friendly !== raw && !raw.includes(friendly)) return { text: friendly, details: '' };
  // A known plain sentence the app itself wrote stays (it ends like one and has no code in it).
  if (/^[A-Z][^{}<>\[\]_=]{12,}[.!?]$/.test(raw) && /\s/.test(raw)) return { text: raw, details: '' };
  return { text: plain, details: raw };
}
