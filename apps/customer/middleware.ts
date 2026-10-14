import { NextResponse, type NextRequest } from 'next/server';
import { isUiLocale, negotiateUiLocale } from '@dealdash/localization';

/** Localized routes: /en/..., /ar/... and /ur/... . Requests without a locale are redirected using Accept-Language. */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const first = pathname.split('/').filter(Boolean)[0];
  if (isUiLocale(first)) return NextResponse.next();
  const locale = negotiateUiLocale(request.headers.get('accept-language'));
  const url = request.nextUrl.clone();
  url.pathname = '/' + locale + (pathname === '/' ? '' : pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next|api|.*\\..*).*)'],
};
