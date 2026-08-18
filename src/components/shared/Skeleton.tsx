/**
 * The pieces a route's loading.tsx is built from.
 *
 * Deliberately dumb and server-rendered: a loading fallback that needs
 * JavaScript to appear defeats the point, since the whole reason it exists is
 * to paint before the interactive page is ready.
 */

/** One grey bar. `w` accepts any CSS length or percentage. */
export function SkelBar({ w = '100%', h = 13 }: { w?: number | string; h?: number }) {
  return <div className="sb-skel" style={{ width: w, height: h }} />
}

/** A run of bars at jittered widths, so it reads as text rather than a grid. */
export function SkelRows({ n, widths }: { n: number; widths?: string[] }) {
  const fallback = ['92%', '68%', '84%', '55%', '76%', '61%', '88%', '49%']
  const w = widths ?? fallback
  return (
    <div className="sb-skel-rows">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="sb-skel sb-skel-row" style={{ width: w[i % w.length] }} />
      ))}
    </div>
  )
}

/** The left rail of both three-pane screens: a find field, then entries. */
export function SkelRail({ className, rows = 9 }: { className: string; rows?: number }) {
  return (
    <aside className={className}>
      <div className="sb-skel-rail">
        <SkelBar h={30} />
        <SkelRows n={rows} />
      </div>
    </aside>
  )
}

/** The centre pane: a bar with its controls, then the table body. */
export function SkelPane({ rows = 10 }: { rows?: number }) {
  return (
    <div className="sb-pane">
      <div className="sb-pane-bar">
        <SkelBar w={190} h={14} />
        <div className="sb-pane-bar-spacer" />
        <SkelBar w={96} h={28} />
      </div>
      <div className="sb-pane-body">
        <SkelRows n={rows} />
      </div>
    </div>
  )
}

/** The right-hand pane while the row behind it is still being read. */
export function SkelDetail() {
  return (
    <div className="sb-skel-rail" style={{ padding: 0, gap: 12 }}>
      <SkelBar w={64} h={9} />
      <SkelBar w="82%" h={17} />
      <SkelBar w="58%" h={11} />
      <div style={{ height: 8 }} />
      <SkelRows n={5} widths={['70%', '46%', '62%', '38%', '54%']} />
    </div>
  )
}
