import { cookies } from 'next/headers';
import { requireUser, type OfficeUser } from '../office/auth';
import { officeSql } from '../office/db';
import { OfficeError } from '../office/http';
import { cleanCategories, isMissingTable, type KioskCategory } from './plan';

/**
 * Kiosk mode on the server. Its tables are new and additive
 * (scripts/kiosk/schema.sql); until they are applied every answer here says
 * "not set up yet" and the rest of the app works exactly as before.
 */

/** A hint for page navigation only (the proxy sends a kiosk browser to /kiosk). Every kiosk API checks the database. */
export const KIOSK_HINT_COOKIE = 'lw-kiosk';

/**
 * `manager`: an owner account (admin or can edit) that isn't a kiosk account.
 * It can open the kiosk as a preview while setting it up, and print from it
 * like any print it could already make in Runs.
 */
export interface KioskAccess { user: OfficeUser; ready: boolean; kiosk: boolean; manager: boolean }
const isManager = (user: OfficeUser) => user.is_admin || user.can_edit;

/** The signed-in account, whether kiosk mode is set up, and whether this is a kiosk account. */
export async function kioskAccess(req: Request): Promise<KioskAccess> {
  const user = await requireUser(req);
  try {
    const rows = await officeSql()`SELECT 1 FROM kiosk_accounts WHERE user_id=${user.id}::uuid`;
    const kiosk = rows.length > 0;
    return { user, ready: true, kiosk, manager: !kiosk && isManager(user) };
  } catch (error) {
    if (isMissingTable(error)) return { user, ready: false, kiosk: false, manager: false };
    throw error;
  }
}

/** A kiosk account, or a manager previewing the kiosk, that may print gets past this. */
export async function requireKiosk(req: Request): Promise<OfficeUser> {
  const access = await kioskAccess(req);
  if (!access.ready) throw new OfficeError('Kiosk mode isn’t set up yet. Ask a manager.', 409);
  if (!access.kiosk && !access.manager) throw new OfficeError('This is for the kiosk account only.', 403);
  if (!access.user.can_print) throw new OfficeError(access.kiosk ? 'This kiosk account can’t print. Ask a manager.' : 'Your account can’t print.', 403);
  return access.user;
}

/** Keep the navigation hint in step with the account (set for a kiosk account, cleared otherwise). */
export async function syncKioskHint(kiosk: boolean) {
  const jar = await cookies();
  if (kiosk) jar.set(KIOSK_HINT_COOKIE, '1', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 30 * 24 * 60 * 60 });
  else if (jar.get(KIOSK_HINT_COOKIE)) jar.delete(KIOSK_HINT_COOKIE);
}

/** Designs marked "Use on kiosk" (null when the table isn't there yet). */
export async function kioskDesignIds(): Promise<string[] | null> {
  try {
    const rows = await officeSql()`SELECT template_id FROM kiosk_designs ORDER BY added_at`;
    return rows.map((row) => String(row.template_id));
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}

/** Each design's categories (null when the table isn't there yet). */
export async function designCategories(): Promise<Record<string, KioskCategory[]> | null> {
  try {
    const rows = await officeSql()`SELECT template_id, category FROM template_categories`;
    const out: Record<string, KioskCategory[]> = {};
    for (const row of rows) {
      const id = String(row.template_id);
      out[id] = cleanCategories([...(out[id] ?? []), String(row.category)]);
    }
    return out;
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}
