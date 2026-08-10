/**
 * The banner that sits above every not-yet-built screen.
 *
 * The shell ports all six screens so the app reads as a whole product, but a
 * screen showing invented claims and conflicts must never be mistakable for one
 * showing the user's actual data. Hence a persistent strip, not a one-time toast.
 */
export function PreviewStrip({ phase }: { phase: number }) {
  return (
    <div className="sb-preview-strip">
      <i className="ph-bold ph-eye" />
      <span>
        Preview — this screen is a design placeholder and is not connected to real data. Arrives
        in Phase {phase}.
      </span>
    </div>
  )
}

export function StubScreen({
  phase,
  title,
  body,
}: {
  phase: number
  title: string
  body: string
}) {
  return (
    <>
      <PreviewStrip phase={phase} />
      <div className="sb-screen" style={{ padding: '24px 20px', maxWidth: 620 }}>
        <h2 style={{ fontSize: 17, fontWeight: 500, margin: '0 0 8px' }}>{title}</h2>
        <p className="sb-muted" style={{ lineHeight: 1.65, margin: 0 }}>
          {body}
        </p>
      </div>
    </>
  )
}
