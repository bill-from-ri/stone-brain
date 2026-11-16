/**
 * The hero's picture of the product: one value conflict, as the Conflicts
 * screen frames it — two claims, two verbatim quotes, and the three ways out.
 *
 * Built in markup rather than shipped as a screenshot so it stays sharp at
 * every width, inherits the real tokens, and cannot drift into showing a
 * screen the product no longer has. The names are invented and the caption
 * says so: a landing page must not pass off a made-up world as a user's data,
 * any more than the app's preview screens may.
 *
 * The example must be a conflict the product actually raises, so it uses a
 * predicate the registry marks single-valued — `death_date` — and two undated
 * claims, which no validity window can reconcile. Check the registry before
 * swapping it for another predicate: functionality is declared per direction,
 * and the plausible-sounding direction is not always the functional one.
 *
 * The action buttons are drawn, not real: spans rather than <button>s, so the
 * figure has no focus stops that do nothing.
 */
export function ConflictIllustration() {
  return (
    <figure className="lp-figure" aria-labelledby="lp-conflict-caption">
      <div className="lp-conflict">
        <div className="lp-conflict-head">
          <i className="ph-bold ph-warning-diamond" aria-hidden="true" />
          <span className="lp-conflict-kind">Value conflict</span>
          <span className="lp-chip">single-valued</span>
        </div>

        <p className="lp-conflict-question">
          When did <strong>Queen Elspeth</strong> die?
        </p>

        <div className="lp-sides">
          <Side
            value="spring of AD 412"
            quote="Queen Elspeth died in the spring of AD 412, three winters after the river took the lower town."
            document="The Varrow Succession"
            paragraph={14}
          />
          <Side
            value="AD 409"
            quote="Elspeth's death in AD 409 left the regency to a council that could agree on nothing."
            document="Council of Nine — Notes"
            paragraph={3}
          />
        </div>

        <div className="lp-conflict-actions" aria-hidden="true">
          <span className="lp-fake-btn lp-fake-btn--primary">Keep one</span>
          <span className="lp-fake-btn">Edit</span>
          <span className="lp-fake-btn">Dismiss</span>
        </div>
      </div>

      {/* <figcaption id="lp-conflict-caption" className="lp-caption">
        Illustration. The world, the names, and the documents are invented.
      </figcaption> */}
    </figure>
  )
}

function Side({
  value,
  quote,
  document,
  paragraph,
}: {
  value: string
  quote: string
  document: string
  paragraph: number
}) {
  return (
    <div className="lp-side">
      <div className="lp-side-claim">
        <span className="lp-mono">death_date</span>
        <span className="lp-side-value">{value}</span>
      </div>
      <blockquote className="lp-quote">{quote}</blockquote>
      <div className="lp-cite">
        <i className="ph ph-file-text" aria-hidden="true" />
        {document} · ¶ {paragraph}
      </div>
    </div>
  )
}
