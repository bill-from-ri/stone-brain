import Link from 'next/link'
import type { NextStep, NextStepsEmpty } from './model'

/**
 * "Pick up where you left off" — the prototype's left column, with one card
 * per real thing worth doing next. The prototype's draft-in-progress card is
 * gone: nothing in the product drafts yet.
 */
export function NextSteps({ steps, empty }: { steps: NextStep[]; empty: NextStepsEmpty | null }) {
  return (
    <section className="sb-home-col" aria-labelledby="sb-home-next">
      <div className="sb-home-col-head">
        <h2 id="sb-home-next" className="sb-home-kicker">
          Pick up where you left off
        </h2>
        <Link className="sb-home-col-link" href="/library">
          All documents
        </Link>
      </div>

      {empty ? (
        <div className="sb-home-empty">
          <i className={`ph ${empty.icon}`} aria-hidden="true" />
          <div>
            <div className="sb-home-empty-title">{empty.title}</div>
            <p>{empty.detail}</p>
            {empty.action && (
              <Link className="btn btn-secondary sb-btn-sm" href={empty.action.href}>
                {empty.action.label}
              </Link>
            )}
          </div>
        </div>
      ) : (
        <ul className="sb-home-steps">
          {steps.map((step) => (
            <li key={step.key}>
              <Link className="sb-home-step" href={step.href}>
                <i className={`ph ${step.icon}`} aria-hidden="true" />
                <div className="sb-home-step-body">
                  <div className="sb-home-step-title">{step.title}</div>
                  <div className="sb-home-step-detail">{step.detail}</div>
                  {(step.tag || step.meta) && (
                    <div className="sb-home-step-meta">
                      {step.tag && (
                        <span className={`tag ${TAG_CLASS[step.tag.tone]}`}>{step.tag.label}</span>
                      )}
                      {step.meta && <span className="sb-home-step-where">{step.meta}</span>}
                    </div>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const TAG_CLASS: Record<NonNullable<NextStep['tag']>['tone'], string> = {
  bad: 'sb-home-tag-bad',
  neutral: 'tag-neutral',
  outline: 'tag-outline',
}
