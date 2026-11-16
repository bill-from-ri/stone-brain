import { entityIcon } from '@/components/shared/entity-icon'

/**
 * What one claim is, drawn from its real parts: subject, predicate, object, an
 * in-world validity window, the verbatim quote it rests on and the paragraph
 * that quote came from — plus the reverse-direction claim that is written
 * alongside it rather than asked of the model.
 *
 * Invented names, labelled as such, for the same reason as the conflict card.
 */
export function ClaimIllustration() {
  return (
    <figure className="lp-figure" aria-labelledby="lp-claim-caption">
      <div className="lp-claim">
        <div className="lp-claim-tuple">
          <span className="lp-entity">
            <i className={entityIcon('character')} aria-hidden="true" />
            Elspeth
          </span>
          <span className="lp-mono lp-predicate">rules</span>
          <span className="lp-entity">
            <i className={entityIcon('society')} aria-hidden="true" />
            Kingdom of Varrow
          </span>
        </div>

        <dl className="lp-claim-facts">
          <div>
            <dt>Holds</dt>
            <dd>AD 391 – AD 412</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>Draft</dd>
          </div>
        </dl>

        <blockquote className="lp-quote">
          Elspeth took the crown of Varrow in AD 391 and held it until her death.
        </blockquote>
        <div className="lp-cite">
          <i className="ph ph-file-text" aria-hidden="true" />
          The Varrow Succession · ¶ 2
        </div>

        <div className="lp-claim-inverse">
          <i className="ph ph-arrows-left-right" aria-hidden="true" />
          <span>
            Written alongside: <span className="lp-mono">Kingdom of Varrow</span>{' '}
            <span className="lp-mono lp-predicate">ruled_by</span>{' '}
            <span className="lp-mono">Elspeth</span>
          </span>
        </div>
      </div>

      {/* <figcaption id="lp-claim-caption" className="lp-caption">
        Illustration of one extracted claim. Invented names.
      </figcaption> */}
    </figure>
  )
}
