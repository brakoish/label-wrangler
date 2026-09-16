import { NextRequest, NextResponse } from 'next/server';
// Optimistic navigation only. Every API verifies the session in the database.
export function proxy(req: NextRequest) {
  if (!req.cookies.get('lw-office-session')?.value) {
    const target=new URL('/login',req.url);
    target.searchParams.set('next',req.nextUrl.pathname+req.nextUrl.search);
    return NextResponse.redirect(target);
  }
  return NextResponse.next();
}
export const config={matcher:['/','/runs/:path*','/designer/:path*','/formats/:path*','/nabis/:path*']};
