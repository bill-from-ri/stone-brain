import type { Metadata } from 'next'
import Link from 'next/link'
import { ClaimIllustration } from '@/components/landing/ClaimIllustration'
import { ConflictIllustration } from '@/components/landing/ConflictIllustration'
import '@/styles/landing.css'

/**
 * The public landing page — what a signed-out `/` shows.
 *
 * It is never reached at this path: src/proxy.ts rewrites a signed-out `/` here
 * and redirects `/welcome` itself back to `/`, so the page has one URL and it is
 * the root. See LANDING_PATH there for why it cannot simply live at `/`.
 *
 * Static by construction: no session read, no query, no client component. The
 * reader is most likely someone following a portfolio link, so it should load
 * instantly and assert nothing the code does not do — every figure below is
 * from the registry or the decision record, and what is not built yet is said
 * outright rather than left for the reader to discover.
 */

const REPO = 'https://github.com/bill-from-ri/stone-brain'
const DOCS = `${REPO}/blob/main/docs`

const TITLE = 'Stone Brain — a continuity checker for worldbuilders'
const DESCRIPTION =
  'Stone Brain mirrors a Google Drive folder read-only, extracts every claim your documents make into a typed graph with verbatim citations, and shows you where they contradict each other.'

export const metadata: Metadata = {
  // Relative URLs below resolve against the root layout's metadataBase.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'Stone Brain',
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary', title: TITLE, description: DESCRIPTION },
}

const CATCHES = [
  {
    icon: 'ph-arrows-split',
    title: 'Values that cannot both be true',
    body: 'Two documents give one thing two values where only one can hold — two death dates for one queen, two rulers of one city in the same year. Only single-valued predicates can conflict, and claims pinned to dates that do not overlap are left alone: a city with two rulers in two different centuries is history, not an error.',
  },
  {
    icon: 'ph-file-x',
    title: 'Claims whose source has gone',
    body: 'When a document is deleted, trashed, or moved out of the folder, the claims it supported are not quietly dropped, and they are not left looking canonical either. Each is raised as its own kind of conflict, still showing the quote it was based on.',
  },
]

const STEPS = [
  {
    name: 'Mirror',
    icon: 'ph-google-drive-logo',
    body: 'You choose one Drive folder. Stone Brain mirrors its tree read-only — it holds no permission to write — and after the first crawl it follows Drive’s change feed, so a sync fetches only what moved. Native Google Docs only.',
  },
  {
    name: 'Extract',
    icon: 'ph-brain',
    body: 'You bring the model: any OpenAI-compatible endpoint, Gemini included. It reads a document and answers in a closed vocabulary of 12 entity types and 73 predicates, quoting the sentence and naming the paragraph each claim came from. Every claim is checked twice — by a Zod schema that can say what is wrong, then by a foreign key in Postgres that nothing gets past.',
  },
  {
    name: 'Reconcile',
    icon: 'ph-arrows-left-right',
    body: 'Each relationship is written in both directions, so “rules” and “ruled by” always agree. Single-valued predicates are compared across every document, with in-world dates taken into account, and the disagreements become conflicts.',
  },
  {
    name: 'Adjudicate',
    icon: 'ph-scales',
    body: 'A conflict shows both claims and both quotes side by side. Keep one, edit the claim, or dismiss the conflict if it is not one. Extraction never decides canon for you: it writes drafts, a re-read only withdraws a draft the document has stopped saying, and a person settles what is true.',
  },
]

const ENGINEERING = [
  {
    title: 'Next.js 16, React 19, all TypeScript',
    body: 'App Router with server components and route handlers, built for Vercel’s serverless runtime. One language and one service: an earlier design with a separate Python extraction service was dropped once the real function limits were checked.',
  },
  {
    title: 'Drizzle on Neon Postgres',
    body: 'One schema owner and one migration tool. The Drive sync is idempotent and resumable because its page token advances only inside the transaction that commits that page’s writes.',
  },
  {
    title: 'The ontology is a typed registry',
    body: 'One TypeScript file declares the vocabulary. It seeds the reference tables, writes the extraction prompt, and types the code. A five-column foreign key from each claim into predicate_signatures enforces predicate, domain, range and value type in the catalog itself.',
  },
  {
    title: 'Idempotent writes',
    body: 'A claim’s identity is a generated fingerprint column under a unique index, so re-extracting a document is an upsert rather than a pile of duplicates.',
  },
  {
    title: 'Scored against hand-labelled ground truth',
    body: 'Documents are labelled by hand into entities and claims, and extraction output is scored against those labels, so a prompt change is measured rather than eyeballed.',
  },
  {
    title: 'Hand-rolled OAuth',
    body: 'Authorization-code flow with PKCE, opaque database-backed sessions, and Google refresh tokens encrypted at rest. Every query takes the user id first and filters on it.',
  },
]

const NOT_YET = [
  {
    title: 'The Assistant',
    body: 'A chat that drafts new material grounded in your claims, with citations, and hands it back as Markdown for you to put in Drive yourself. Planned; not started. Its place in the app stays dimmed until it is real.',
  },
  {
    title: 'Other file types',
    body: 'Only native Google Docs are read. Sheets, Slides, PDFs and uploaded files in the folder are skipped.',
  },
  {
    title: 'Google’s verification',
    body: 'Stone Brain has not been through Google’s review for Drive access, so Google shows an unverified-app screen before its consent screen, and the app can serve at most 100 accounts.',
  },
]

export default function LandingPage() {
  return (
    <div className="lp">
      <a className="lp-skip" href="#lp-main">
        Skip to content
      </a>

      <header className="lp-header">
        <div className="lp-wrap lp-header-row">
          <Link className="lp-brand" href="/">
            <span className="lp-mark" aria-hidden="true">
              <i className="ph ph-diamond" />
            </span>
            <span>Stone Brain</span>
          </Link>
          <nav className="lp-nav" aria-label="Page sections">
            <a href="#how">How it works</a>
            <a href="#engineering">Under the hood</a>
            <a href={REPO}>GitHub</a>
          </nav>
          <a className="btn btn-primary lp-header-cta" href="/connect">
            Connect Google Drive
          </a>
        </div>
      </header>

      <main id="lp-main" tabIndex={-1}>
        <section className="lp-hero" aria-labelledby="lp-hero-title">
          <div className="lp-wrap lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="lp-kicker">A continuity checker for worldbuilders</p>
              <h1 id="lp-hero-title">Find where your world contradicts itself.</h1>
              <p className="lp-lede">
                Stone Brain reads a Google Drive folder of worldbuilding documents, turns every
                claim they make into a typed graph, and shows you where two documents disagree —
                quoting the paragraph each side came from.
              </p>
              <div className="lp-actions">
                <a className="btn btn-primary lp-btn-lg" href="/connect">
                  <i className="ph-bold ph-google-logo" aria-hidden="true" />
                  Connect Google Drive
                </a>
                <a className="btn btn-secondary lp-btn-lg" href={REPO}>
                  <i className="ph ph-github-logo" aria-hidden="true" />
                  Read the source
                </a>
              </div>
              <ul className="lp-assurances">
                <li>
                  <i className="ph ph-folder-open" aria-hidden="true" />
                  One folder you choose
                </li>
                <li>
                  <i className="ph ph-prohibit" aria-hidden="true" />
                  Nothing written to Drive
                </li>
                <li>
                  <i className="ph ph-key" aria-hidden="true" />
                  Your own model and key
                </li>
              </ul>
            </div>
            <ConflictIllustration />
          </div>
        </section>

        <section className="lp-section" aria-labelledby="lp-catches-title">
          <div className="lp-wrap">
            <h2 id="lp-catches-title" className="lp-h2">
              What it catches
            </h2>
            <p className="lp-intro">
              A world written across dozens of documents drifts. Stone Brain looks for the two
              kinds of drift a careful reader would flag, and nothing it cannot back with a quote.
            </p>
            <div className="lp-catches">
              {CATCHES.map((c) => (
                <article className="lp-card" key={c.title}>
                  <i className={`ph ${c.icon} lp-card-icon`} aria-hidden="true" />
                  <h3>{c.title}</h3>
                  <p>{c.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="lp-section" aria-labelledby="lp-how-title">
          <div className="lp-wrap">
            <h2 id="lp-how-title" className="lp-h2">
              How it works
            </h2>
            <div className="lp-how-grid">
              <ol className="lp-steps">
                {STEPS.map((s, i) => (
                  <li className="lp-step" key={s.name}>
                    <span className="lp-step-n" aria-hidden="true">
                      {i + 1}
                    </span>
                    <div>
                      <h3>
                        <i className={`ph ${s.icon}`} aria-hidden="true" />
                        {s.name}
                      </h3>
                      <p>{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="lp-how-aside">
                <p className="lp-aside-label">What one claim holds</p>
                <ClaimIllustration />
              </div>
            </div>
          </div>
        </section>

        <section id="engineering" className="lp-section" aria-labelledby="lp-eng-title">
          <div className="lp-wrap">
            <h2 id="lp-eng-title" className="lp-h2">
              Under the hood
            </h2>
            <p className="lp-intro">
              For the engineers reading. The reasoning behind each of these — including the
              decisions that were reversed, and why — is written up in the{' '}
              <a href={`${DOCS}/architecture-decisions.md`}>architecture decision record</a> and
              the <a href={`${DOCS}/ontology-design.md`}>ontology design</a>.
            </p>
            <dl className="lp-eng">
              {ENGINEERING.map((e) => (
                <div className="lp-eng-item" key={e.title}>
                  <dt>{e.title}</dt>
                  <dd>{e.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="lp-section" aria-labelledby="lp-notyet-title">
          <div className="lp-wrap">
            <h2 id="lp-notyet-title" className="lp-h2">
              Not built yet
            </h2>
            <p className="lp-intro">Said here rather than left for you to find.</p>
            <ul className="lp-notyet">
              {NOT_YET.map((n) => (
                <li key={n.title}>
                  <h3>{n.title}</h3>
                  <p>{n.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-cta" aria-labelledby="lp-cta-title">
          <div className="lp-wrap lp-cta-inner">
            <h2 id="lp-cta-title">Point it at your world.</h2>
            <p>
              Sign in with Google, choose one folder, and add a model in Settings when you are
              ready to extract.
            </p>
            <a className="btn btn-primary lp-btn-lg" href="/connect">
              <i className="ph-bold ph-google-logo" aria-hidden="true" />
              Connect Google Drive
            </a>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-row">
          <span>Stone Brain · MIT licensed</span>
          <a href={REPO}>Source on GitHub</a>
        </div>
      </footer>
    </div>
  )
}
