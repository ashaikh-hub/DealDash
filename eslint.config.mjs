import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      'apps/api/src/generated/**',
      'packages/api-client/src/schema.d.ts',
      'apps/*/next-env.d.ts',
      'apps/*/public/sw.js',
      'docs/**',
      'Figma Files/**',
      'tooling/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': 'off',
    },
  },
  {
    // Nest uses constructor parameter types at runtime (decorator metadata): type-only imports would break DI.
    files: ['apps/api/src/**/*.ts', 'apps/api/test/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // Module boundary rule: frontends and shared packages must never import database code or the API.
    files: ['apps/!(api)/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/generated/prisma/**', '@prisma/*', 'prisma'],
              message: 'Frontends and shared packages must not import database code.',
            },
            {
              group: ['**/apps/api/**', '@dealdash/api'],
              message:
                'Use @dealdash/api-client (generated contract) instead of importing the API.',
            },
          ],
        },
      ],
    },
  },
);
