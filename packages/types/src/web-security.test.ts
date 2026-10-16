import { describe, expect, it } from 'vitest';
import { NOINDEX, robotsRules, webAppEnv, webSecurityHeaders } from './web-security';

/** Remote UAT (G-6): staging / UAT pages and every business portal are never indexed. */
describe('web security headers and indexing', () => {
  const robotsTag = (h: Array<{ key: string; value: string }>) =>
    h.find((x) => x.key === 'X-Robots-Tag')?.value;

  it('sends noindex unless the page may be indexed', () => {
    expect(robotsTag(webSecurityHeaders({ production: true }))).toBe(NOINDEX);
    expect(robotsTag(webSecurityHeaders({ production: true, indexable: false }))).toBe(NOINDEX);
    expect(robotsTag(webSecurityHeaders({ production: true, indexable: true }))).toBeUndefined();
    expect(NOINDEX).toContain('noindex');
    expect(NOINDEX).toContain('nofollow');
  });

  it('only a production build is "production"; staging / uat are staging; anything else is local', () => {
    expect(webAppEnv('production')).toBe('production');
    expect(webAppEnv('staging')).toBe('staging');
    expect(webAppEnv('uat')).toBe('staging');
    expect(webAppEnv(undefined)).toBe('local');
    expect(webAppEnv('Production')).toBe('local');
  });

  it('robots.txt disallows everything unless indexable', () => {
    expect(robotsRules(false)).toEqual({ rules: [{ userAgent: '*', disallow: '/' }] });
    expect(robotsRules(true)).toEqual({ rules: [{ userAgent: '*', allow: '/' }] });
  });

  it('keeps the existing protections', () => {
    const h = webSecurityHeaders({ production: true, camera: true });
    expect(h).toEqual(
      expect.arrayContaining([
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      ]),
    );
  });
});
