import 'server-only'
import { env } from './env'

/**
 * Feature flags.
 *
 * Server-only and environment-driven on purpose: a flag read in the browser is a
 * flag any user can flip, and these gate things that are meant for the operator
 * rather than the person using the app. Gate in a server component and let the
 * markup for a disabled flag never be rendered at all, rather than hiding it
 * with CSS.
 *
 * To turn one on locally, set it in .env.local and restart `next dev`.
 */
export const flags = {
  /**
   * Show the Drive file id and the Stone Brain row id in the Library's detail
   * pane. Useful when reconciling the mirror against Drive by hand; meaningless
   * noise to everyone else. Env: SHOW_DOCUMENT_IDS=1
   */
  showDocumentIds: env.SHOW_DOCUMENT_IDS,
} as const
