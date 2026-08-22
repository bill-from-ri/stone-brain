'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { EntityTypeOption } from '@/db/queries/claims'
import { entityIcon } from '@/components/shared/entity-icon'
import { normalizeName } from '@/lib/ontology/name-key'

/**
 * Adding an entity by hand.
 *
 * Two fields, because an entity is two facts: what it is called and what kind
 * of thing it is. Everything else about it — its summary, its alternate
 * spellings, the claims that give it substance — arrives afterwards, and a form
 * that asked for them up front would be asking you to describe something you
 * have only just decided exists.
 *
 * The type is the load-bearing half. It decides which predicates can ever take
 * this entity as a subject (the signature FK, via the editor's pickers), so
 * getting it wrong is not cosmetic — hence the list of legal types rather than
 * a free-text field, and hence the hint under it.
 *
 * ## The duplicate warning
 *
 * `entities.normalized_name` is deliberately not unique: two real things of one
 * type may share a name. But a *near-miss* — a second "Ashfall" typed because
 * the first was not visible from here — is the thing the matcher exists to
 * prevent, and this form is the one place a person can create one on purpose.
 * So a collision is surfaced as a warning that does not block the save. It
 * names the entity you may have meant; deciding they are the same thing is a
 * merge, which is a Phase 3 operation and not something to fake with a refusal.
 */
export function EntityEditor({
  entities,
  entityTypes,
  onCreated,
}: {
  /** The existing entities, purely to notice a duplicate name before saving. */
  entities: { id: string; name: string; entityType: string }[]
  entityTypes: EntityTypeOption[]
  /** Hands back the new entity's id, so the pane can open over it. */
  onCreated: (id: string) => void
}) {
  const router = useRouter()

  const [name, setName] = useState('')
  const [entityType, setEntityType] = useState(entityTypes[0]?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const trimmed = name.trim()

  /*
   * Compared on the matcher's own normalisation rather than on the raw string,
   * so "the Ashfall Compact" and "Ashfall Compact" are recognised as the near
   * miss they are. Same type only: a person and a place sharing a name is
   * ordinary and warning about it would be noise.
   */
  const duplicate = trimmed
    ? (entities.find(
        (e) => e.entityType === entityType && normalizeName(e.name) === normalizeName(trimmed),
      ) ?? null)
    : null

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy(true)

    const res = await fetch('/api/entities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: trimmed, entityType }),
    })

    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; id?: string; error?: string }
      | null
    setBusy(false)

    if (!body?.ok || !body.id) {
      setError(body?.error ?? 'Could not create that entity.')
      return
    }

    setName('')
    // The rail, the type counts and the claim editor's pickers all read the
    // entity list from the server, so they need the refresh; the pane opens
    // over the new entity without waiting for it.
    onCreated(body.id)
    router.refresh()
  }

  return (
    <form className="sb-claim-form" onSubmit={submit}>
      <div className="sb-detail-kicker">New entity</div>

      <label className="sb-field">
        <span>Name</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ashfall"
          autoFocus
          required
        />
      </label>

      <label className="sb-field">
        <span>Type</span>
        <select
          className="input"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          required
        >
          {entityTypes.map((type) => (
            <option key={type.name} value={type.name}>
              {type.label}
            </option>
          ))}
        </select>
        <p className="sb-field-hint">
          The type decides which claims this entity can ever be the subject of.
        </p>
      </label>

      {duplicate && (
        <div className="sb-inverse-note">
          <div className="sb-entity-dupe">
            <i className={entityIcon(duplicate.entityType)} />
            {duplicate.name}
          </div>
          <p className="sb-claim-note">
            An entity of this type is already written this way. Saving will make a second one.
          </p>
        </div>
      )}

      {error && <p className="sb-form-error">{error}</p>}

      <button type="submit" className="btn btn-primary sb-btn-sm" disabled={busy || !trimmed}>
        {busy ? 'Saving…' : 'Save entity'}
      </button>
    </form>
  )
}
