import { NextRequest, NextResponse } from 'next/server';
// Optimistic navigation only. Every API verifies the session in the database.
export function proxy(req: NextRequest) {
  if (!req.cookies.get('lw-office-session')?.value) {
    const target=new URL('/login',req.url);
    target.searchParams.set('next',req.nextUrl.pathname+req.nextUrl.search);
    return NextResponse.redirect(target);
  }
  // A kiosk computer (its account is a kiosk account, see /api/kiosk/status)
  // only ever shows the kiosk. The kiosk APIs check the account themselves.
  if (req.cookies.get('lw-kiosk')?.value && !req.nextUrl.pathname.startsWith('/kiosk')) {
    return NextResponse.redirect(new URL('/kiosk',req.url));
  }
  return NextResponse.next();
}
export const config={matcher:['/','/runs/:path*','/designer/:path*','/formats/:path*','/nabis/:path*','/kiosk','/kiosk/:path*']};
