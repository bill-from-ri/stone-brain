import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { env } from '@/lib/env'
import '@phosphor-icons/web/regular'
import '@phosphor-icons/web/bold'
import '@/styles/nocturne.css'
import '@/styles/tokens.css'
import '@/styles/components.css'

// Nocturne specifies Inter. Self-hosted via next/font rather than the design
// system's original Google Fonts @import — see the note at the top of nocturne.css.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
})

/*
 * Defaults for every route. `metadataBase` is here rather than on the one
 * page that first needed it (the landing page's Open Graph URLs must be
 * absolute) because any page that later sets an image or a canonical URL
 * needs it too, and Next resolves those against the nearest base up the tree.
 * APP_URL is the same origin the OAuth redirect is built from, so the two
 * cannot disagree about where the app lives.
 *
 * The template names the product after each screen's own title — "World ·
 * Stone Brain" — so a row of tabs reads by screen.
 */
export const metadata: Metadata = {
  metadataBase: new URL(env.APP_URL),
  title: { default: 'Stone Brain', template: '%s · Stone Brain' },
  description:
    'Reads the documents in one Drive folder, extracts the claims they make, and tells you when they disagree with each other.',
  applicationName: 'Stone Brain',
}

/*
 * The font is applied by the `--font-heading` / `--font-body` tokens in
 * tokens.css, which read the `--font-inter` variable this class sets — not by
 * an inline style here, which reached the body and nothing that sets its own
 * family (headings, buttons, tags).
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  )
}
