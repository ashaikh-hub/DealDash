import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { createElement } from 'react';

// Next.js router hooks and Link are mocked: tests render the shell without a running Next server.
vi.mock('next/navigation', () => ({
  usePathname: () => globalThis.__TEST_PATH__ ?? '/en',
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement('a', { href, ...rest }, children),
}));

declare global {
  var __TEST_PATH__: string | undefined;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.__TEST_PATH__ = undefined;
});
