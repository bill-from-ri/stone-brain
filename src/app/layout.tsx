import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
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

export const metadata: Metadata = {
  title: 'Stone Brain',
  description:
    'Reads the documents in one Drive folder, extracts the claims they make, and tells you when they disagree with each other.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body style={{ fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  )
}
