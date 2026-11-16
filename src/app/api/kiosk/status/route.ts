import { json, browserFailure, sameOrigin, OfficeError } from '@/lib/office/http';
import { kioskAccess, syncKioskHint } from '@/lib/kiosk/server';

/**
 * Whether the signed-in account is a kiosk account, and whether kiosk mode is
 * set up. Keeps the navigation hint cookie in step (the proxy uses it to send
 * a kiosk browser to /kiosk); every kiosk API checks the database itself.
 */
export async function GET(req: Request) {
  try {
    const access = await kioskAccess(req);
    await syncKioskHint(access.kiosk);
    return json({ ready: access.ready, kiosk: access.kiosk, canEdit: access.user.can_edit, canPrint: access.user.can_print, username: access.user.username });
  } catch (error) {
    if (error instanceof OfficeError && error.status === 401) await syncKioskHint(false).catch(() => {});
    return browserFailure(error);
  }
}

/** Signing out of the kiosk: the hint goes, so the next person's pages open normally. */
export async function DELETE(req: Request) {
  try { sameOrigin(req); await syncKioskHint(false); return json({ ok: true }); } catch (error) { return browserFailure(error); }
}
