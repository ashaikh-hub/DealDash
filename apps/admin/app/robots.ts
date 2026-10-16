import type { MetadataRoute } from 'next';
import { robotsRules } from '@dealdash/types';

/** robots.txt (G-6): the admin portal is never indexed, in any environment. */
export default function robots(): MetadataRoute.Robots {
  return robotsRules(false);
}
