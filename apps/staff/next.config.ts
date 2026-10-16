import type { NextConfig } from 'next';
import { webSecurityHeaders } from '@dealdash/types';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Shared workspace packages are pre-built (tsup) so no transpilation is needed here.
  // Stage 9: security headers (the staff app scans QR codes, so the camera is allowed for this origin only)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: webSecurityHeaders({
          camera: true,
          production: process.env.NODE_ENV === 'production',
          indexable: false, // business app: never indexed in any environment (G-6)
        }),
      },
    ];
  },
};

export default config;
