import Link from 'next/link'
import { timeAgo, type ActivityItem } from './model'

/**
 * The prototype's right column, limited to the two kinds of event the
 * database records: extraction runs, succeeded or failed, and the last sync.
 * Its "Verified", "Drafted" and "Merged" rows have no history table behind
 * them, so they are not here.
 */
export function RecentActivity({ items, now }: { items: ActivityItem[]; now: Date }) {
  return (
    <section className="sb-home-col" aria-labelledby="sb-home-activity">
      <div className="sb-home-col-head">
        <h2 id="sb-home-activity" className="sb-home-kicker">
          Recent activity
        </h2>
      </div>

      {items.length === 0 ? (
        <div className="sb-home-empty sb-home-empty--quiet">
          <i className="ph ph-clock-counter-clockwise" aria-hidden="true" />
          <div>
            <p>Syncs and extractions will be listed here as they happen.</p>
          </div>
        </div>
      ) : (
        <ul className="sb-home-activity">
          {items.map((item) => (
            <li key={item.key} className="sb-home-event">
              <i className={`ph ${item.icon}`} data-tone={item.tone} aria-hidden="true" />
              <div className="sb-home-event-body">
                <div className="sb-home-event-text">
                  {item.lead}
                  {item.subject && (
                    <>
                      {' '}
                      {item.href ? (
                        <Link href={item.href}>{item.subject}</Link>
                      ) : (
                        <strong>{item.subject}</strong>
                      )}
                    </>
                  )}
                </div>
                <div className="sb-home-event-meta">
                  {item.detail && <>{item.detail} · </>}
                  <time dateTime={item.at.toISOString()}>{timeAgo(item.at, now)}</time>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
