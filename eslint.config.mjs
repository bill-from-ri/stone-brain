import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

/*
 * ESLint's flat config, as Next 16 recommends now that `next lint` is gone:
 * the Core Web Vitals set (Next, React, React Hooks) plus typescript-eslint's
 * recommended rules. See node_modules/next/dist/docs/01-app/03-api-reference/
 * 05-config/03-eslint.md.
 */
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // A leading underscore is how this codebase marks a binding that is
      // destructured only to be left out (`claimCount: _claimCount, ...row`).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
  globalIgnores([
    // eslint-config-next's defaults, restated because a globalIgnores here replaces them.
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Not the app: the design export (a runtime-interpreted template), a
    // throwaway OAuth spike, and captured model output.
    'frontend/**',
    'spikes/**',
    'scoring/**',
  ]),
])
