import type { Response } from 'express';
import type { ApiEnv } from '@dealdash/config';
import { AUDIENCE_DEFINITIONS, type Audience } from '@dealdash/types';

/** httpOnly, same-site session cookie, one name per app audience so the five apps never overwrite each other. */
export function setSessionCookie(res: Response, env: ApiEnv, audience: Audience, token: string) {
  res.cookie(AUDIENCE_DEFINITIONS[audience].cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: 14 * 24 * 3600 * 1000,
  });
}
