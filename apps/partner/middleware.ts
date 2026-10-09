import { NextResponse, type NextRequest } from 'next/server';
import { isLocale, negotiateLocale } from '@dealdash/localization';

/** Localized routes: /en/... and /ar/... . Requests without a locale are redirected using Accept-Language. */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const first = pathname.split('/').filter(Boolean)[0];
  if (isLocale(first)) return NextResponse.next();
  const locale = negotiateLocale(request.headers.get('accept-language'));
  const url = request.nextUrl.clone();
  url.pathname = '/' + locale + (pathname === '/' ? '' : pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next|api|.*\\..*).*)'],
};
