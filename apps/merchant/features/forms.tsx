'use client';

import { useCallback, useState } from 'react';
import { errorMessage, fieldErrors, useAuth, type ApiResult } from '@dealdash/app-shell';
import { createTranslator } from '@dealdash/localization';

/** Tracks a running command, its error banner and its per-field errors. */
export function useCommand() {
  const { locale } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const clear = useCallback(() => {
    setError(null);
    setFields({});
  }, []);

  const exec = useCallback(
    async <T,>(fn: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> => {
      setBusy(true);
      setError(null);
      setFields({});
      try {
        const res = await fn();
        if (!res.ok) {
          setError(errorMessage(locale, res.errors));
          setFields(fieldErrors(locale, res.errors));
        }
        return res;
      } finally {
        setBusy(false);
      }
    },
    [locale],
  );

  const fail = useCallback((message: string, byField: Record<string, string> = {}) => {
    setError(message);
    setFields(byField);
  }, []);

  return { busy, error, fields, exec, clear, fail };
}

/**
 * Validates with the SAME shared Zod schema the API uses. In English the schema message is shown; in Arabic a
 * translated generic message marks the invalid fields (server remains the authority).
 */
/** Structural type so any shared Zod schema works without this app importing zod itself. */
export interface Parseable<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: {
          issues: ReadonlyArray<{
            path: ReadonlyArray<PropertyKey>;
            message: string;
            code: string;
          }>;
        };
      };
}

export function validateWith<T>(
  schema: Parseable<T>,
  value: unknown,
  locale: 'en' | 'ar',
): { ok: true; data: T } | { ok: false; fields: Record<string, string> } {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  const t = createTranslator(locale);
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? '');
    if (!key || fields[key]) continue;
    const empty =
      issue.code === 'too_small' &&
      value &&
      typeof value === 'object' &&
      !(value as Record<string, unknown>)[key];
    fields[key] = empty ? t('form.required') : locale === 'en' ? issue.message : t('form.invalid');
  }
  return { ok: false, fields };
}

export const emptyToUndefined = (v: string): string | undefined =>
  v.trim() === '' ? undefined : v.trim();
