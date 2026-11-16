import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The OAuth spike in spikes/ and the private seed data in corpus/ are not build
  // inputs. tsconfig excludes them; this keeps tracing honest too.
  outputFileTracingExcludes: {
    '*': ['./spikes/**/*', './corpus/**/*', './docs/**/*'],
  },
  typedRoutes: true,
}

export default nextConfig
