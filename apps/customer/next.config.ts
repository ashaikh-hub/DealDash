import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Shared workspace packages are pre-built (tsup) so no transpilation is needed here.
};

export default config;
