import type { NextConfig } from 'next';
import { webAppEnv, webSecurityHeaders } from '@dealdash/types';

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
          // only a production build of the customer app may be indexed (staging / UAT never: G-6)
          indexable: webAppEnv(process.env.NEXT_PUBLIC_APP_ENV) === 'production',
        }),
      },
    ];
  },
};

export default config;
