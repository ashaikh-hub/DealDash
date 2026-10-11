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
  return headers;
}
