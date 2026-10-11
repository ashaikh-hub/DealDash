import type { NextConfig } from 'next';
import { webSecurityHeaders } from '@dealdash/types';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Shared workspace packages are pre-built (tsup) so no transpilation is needed here.
  // Stage 9: security headers (discovery uses the location, for this origin only)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: webSecurityHeaders({
          geolocation: true,
          production: process.env.NODE_ENV === 'production',
        }),
      },
    ];
  },
};

export default config;
