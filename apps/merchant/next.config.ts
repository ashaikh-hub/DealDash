import type { NextConfig } from 'next';
import { webSecurityHeaders } from '@dealdash/types';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Shared workspace packages are pre-built (tsup) so no transpilation is needed here.
  // Stage 9: security headers
  async headers() {
    return [
      {
        source: '/:path*',
        // business portal: never indexed in any environment (G-6)
        headers: webSecurityHeaders({
          production: process.env.NODE_ENV === 'production',
          indexable: false,
        }),
      },
    ];
  },
};

export default config;
