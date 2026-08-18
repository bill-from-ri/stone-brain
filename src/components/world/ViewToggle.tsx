'use client'

import { useParamWriter } from '@/components/shared/RecordTable'

export type WorldViewMode = 'table' | 'graph'

/**
 * Table or graph, the prototype's segmented control (line 661).
 *
 * The mode lives in the query string rather than in component state so a link
 * to the graph is a link to the graph, and so switching views never disturbs
 * the entity or claim you already had selected.
 */
export function ViewToggle({ view }: { view: WorldViewMode }) {
  const setParams = useParamWriter()

  const choose = (next: WorldViewMode) =>
    setParams((p) => {
      if (next === 'table') p.delete('view')
      else p.set('view', next)
      // The claim pane is about a row in the table; leaving it open over the
      // graph would be a pane about something you can no longer see.
      if (next === 'graph') p.delete('claim')
    })

  return (
    <div className="seg sb-view-toggle">
      {(['table', 'graph'] as const).map((mode) => (
        <label key={mode} className="seg-opt">
          <input
            type="radio"
            name="world-view"
            checked={view === mode}
            onChange={() => choose(mode)}
          />
          <i className={`ph ${mode === 'table' ? 'ph-rows' : 'ph-graph'}`} />
          {mode === 'table' ? 'Table' : 'Graph'}
        </label>
      ))}
    </div>
  )
}
