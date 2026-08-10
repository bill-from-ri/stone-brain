import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The design prototype in frontend/ and the OAuth spike in spikes/ are reference
  // material, not build inputs. tsconfig excludes them; this keeps tracing honest too.
  outputFileTracingExcludes: {
    '*': ['./frontend/**/*', './spikes/**/*', './docs/**/*'],
  },
  typedRoutes: true,
}

export default nextConfig
