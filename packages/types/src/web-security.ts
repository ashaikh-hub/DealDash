/**
 * Stage 9: the security headers every DealDash web app sends (Next.js `headers()`). Framing is refused (clickjacking), MIME sniffing
 * is off, referrers are trimmed, powerful browser features are allowed only where the app needs them (camera for staff QR scanning,
 * location for customer discovery), and HTTPS is pinned in production (HSTS). A nonce-based script Content-Security-Policy is a
 * separate, tracked hardening item (the Next.js runtime needs nonces; see docs/SECURITY_TESTING_HANDOFF.md).
 */
export function webSecurityHeaders(opts: {
  camera?: boolean;
  geolocation?: boolean;
  production: boolean;
  /**
   * Remote UAT (G-6): only a page meant for search engines may be indexed. Every non-production environment (staging, UAT, local)
   * and every business portal sends `X-Robots-Tag: noindex` (with robots.txt disallowing everything) whatever its host.
   */
  indexable?: boolean;
}): Array<{ key: string; value: string }> {
  const headers = [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: `camera=(${opts.camera ? 'self' : ''}), geolocation=(${opts.geolocation ? 'self' : ''}), microphone=(), payment=(), usb=()`,
    },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    // the minimum policy that does not break the Next.js runtime: no framing, no plugins, no base-tag hijacking
    {
      key: 'Content-Security-Policy',
      value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
    },
  ];
  if (opts.production)
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000; includeSubDomains',
    });
  if (!opts.indexable) headers.push({ key: 'X-Robots-Tag', value: NOINDEX });
  return headers;
}

/** What search engines are told about pages that must never be listed (staging / UAT, portals, the API). */
export const NOINDEX = 'noindex, nofollow, noarchive, nosnippet';

/**
 * The deployment tier a web app was BUILT for (`NEXT_PUBLIC_APP_ENV`, a public build setting; unset = local development). Only
 * `production` builds of the customer app may be indexed; staging builds also show the "STAGING · test data" ribbon (G-7).
 */
export function webAppEnv(value: string | undefined): 'production' | 'staging' | 'local' {
  return value === 'production'
    ? 'production'
    : value === 'staging' || value === 'uat'
      ? 'staging'
      : 'local';
}

/** robots.txt for a web app: everything disallowed unless the app may be indexed (Next.js `app/robots.ts`). */
export function robotsRules(indexable: boolean) {
  return indexable
    ? { rules: [{ userAgent: '*', allow: '/' }] }
    : { rules: [{ userAgent: '*', disallow: '/' }] };
}
