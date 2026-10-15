import { describe, expect, it } from 'vitest';
import { resolveApiUrl } from './providers';

describe('resolveApiUrl', () => {
  it('keeps the configured address on the laptop and on the server', () => {
    expect(resolveApiUrl('http://localhost:4000', 'localhost')).toBe('http://localhost:4000');
    expect(resolveApiUrl('http://localhost:4000', '127.0.0.1')).toBe('http://localhost:4000');
    expect(resolveApiUrl('http://localhost:4000', undefined)).toBe('http://localhost:4000');
  });

  it('follows the page host when a phone opens the app through the laptop network address', () => {
    expect(resolveApiUrl('http://localhost:4000', '192.168.70.107')).toBe(
      'http://192.168.70.107:4000',
    );
    expect(resolveApiUrl('http://127.0.0.1:4000', '10.0.0.8')).toBe('http://10.0.0.8:4000');
  });

  it('never rewrites a real environment address', () => {
    expect(resolveApiUrl('https://api.staging.example', '192.168.70.107')).toBe(
      'https://api.staging.example',
    );
  });
});
