import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseApiEnv, type ApiEnv } from '@dealdash/config';

export const APP_ENV = Symbol('APP_ENV');

/** Loads the repo-root .env when running from the API folder (never overrides real environment variables). */
export function loadDotEnv(): void {
  for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
    if (existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate);
      } catch {
        /* ignore malformed file; validation below reports missing values */
      }
      return;
    }
  }
}

export function loadEnv(overrides: Record<string, string | undefined> = {}): ApiEnv {
  return parseApiEnv({ ...process.env, ...overrides });
}
