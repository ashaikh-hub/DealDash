import type { MetadataRoute } from 'next';
import { robotsRules, webAppEnv } from '@dealdash/types';

/** robots.txt (G-6): staging / UAT and local builds disallow everything; only a production build may be indexed. */
export default function robots(): MetadataRoute.Robots {
  return robotsRules(webAppEnv(process.env.NEXT_PUBLIC_APP_ENV) === 'production');
}
