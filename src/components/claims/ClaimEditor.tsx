'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import type { EntityTypeOption, PredicateOption, SignatureRow } from '@/db/queries/claims'

const NONE = '@none'

type EntityOption = { id: string; name: string; entityType: string }

/**
 * Writing a claim by hand.
 *
 * The pickers are driven by the ontology rather than validating against it
 * after the fact: choosing a subject narrows the predicate list to those whose
 * domain accepts that type, and choosing a predicate narrows the object list to
 * its range. An illegal claim is therefore not merely rejected — it cannot be
 * expressed, which is the same principle as the signature foreign key, applied
 * one layer up.
 *
 * The server re-checks everything regardless. This is convenience, not
 * enforcement; a picker can be bypassed and the catalog cannot.
 */
export function ClaimEditor({
  entities,
  entityTypes,
  predicates,
  signatures,
}: {
  entities: EntityOption[]
  entityTypes: EntityTypeOption[]
  predicates: PredicateOption[]
  signatures: SignatureRow[]
}) {
  const router = useRouter()

  const [subjectId, setSubjectId] = useState('')
  const [predicate, setPredicate] = useState('')
  const [objectId, setObjectId] = useState('')
  const [value, setValue] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [createInverse, setCreateInverse] = useState(true)

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const subject = entities.find((e) => e.id === subjectId) ?? null
  const chosen = predicates.find((p) => p.name === predicate) ?? null

  /** Predicates whose domain accepts the chosen subject's type. */
  const available = useMemo(() => {
    if (!subject) return []
    const legal = new Set(
      signatures.filter((s) => s.subjectType === subject.entityType).map((s) => s.predicate),
    )
    return predicates.filter((p) => legal.has(p.name))
  }, [subject, predicates, signatures])

  /** Entity types this predicate accepts as object, given the subject's type. */
  const objectCandidates = useMemo(() => {
    if (!subject || !chosen || chosen.kind !== 'relationship') return []
    const legalTypes = new Set(
      signatures
        .filter(
          (s) =>
            s.predicate === chosen.name &&
            s.subjectType === subject.entityType &&
            s.objectType !== NONE,
        )
        .map((s) => s.objectType),
    )
    return entities.filter((e) => e.id !== subject.id && legalTypes.has(e.entityType))
  }, [entities, signatures, subject, chosen])

  const inversePreview =
    chosen?.kind === 'relationship' && chosen.inverseName && subject && objectId
      ? `${entities.find((e) => e.id === objectId)?.name ?? '…'} — ${chosen.inverseName} → ${subject.name}`
      : null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)

    const res = await fetch('/api/claims', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subjectId,
        predicate,
        objectId: chosen?.kind === 'relationship' ? objectId : null,
        value: chosen?.kind === 'attribute' ? value : null,
        startTime: startTime || null,
        endTime: endTime || null,
        createInverse,
      }),
    })

    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    setBusy(false)

    if (!body?.ok) {
      setError(body?.error ?? 'Could not save that claim.')
      return
    }

    setPredicate('')
    setObjectId('')
    setValue('')
    setStartTime('')
    setEndTime('')
    router.refresh()
  }

  return (
    <form className="sb-claim-form" onSubmit={submit}>
      <div className="sb-detail-kicker">New claim</div>

      <label className="sb-field">
        <span>Subject</span>
        <select
          className="input"
          value={subjectId}
          onChange={(e) => {
            setSubjectId(e.target.value)
            setPredicate('')
          }}
          required
        >
          <option value="">Choose an entity…</option>
          {entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} — {labelOf(entityTypes, e.entityType)}
            </option>
          ))}
        </select>
      </label>

      <label className="sb-field">
        <span>Predicate</span>
        <select
          className="input"
          value={predicate}
          onChange={(e) => {
            setPredicate(e.target.value)
            setObjectId('')
            setValue('')
          }}
          disabled={!subject}
          required
        >
          <option value="">Choose a predicate…</option>
          {available.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} {p.kind === 'attribute' ? `(${p.valueType})` : ''}
            </option>
          ))}
        </select>
      </label>

      {chosen && <p className="sb-field-hint">{chosen.description}</p>}

      {chosen?.kind === 'attribute' ? (
        <label className="sb-field">
          <span>Value</span>
          {chosen.valueEnum ? (
            <select
              className="input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            >
              <option value="">Choose…</option>
              {chosen.valueEnum.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={chosen.valueType === 'date' ? 'e.g. AD 412' : ''}
              required
            />
          )}
        </label>
      ) : (
        chosen && (
          <label className="sb-field">
            <span>Object</span>
            <select
              className="input"
              value={objectId}
              onChange={(e) => setObjectId(e.target.value)}
              required
            >
              <option value="">Choose an entity…</option>
              {objectCandidates.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} — {labelOf(entityTypes, e.entityType)}
                </option>
              ))}
            </select>
            {objectCandidates.length === 0 && (
              <p className="sb-field-hint">
                No entity of a type this predicate accepts exists yet.
              </p>
            )}
          </label>
        )
      )}

      <div className="sb-field-row">
        <label className="sb-field">
          <span>From</span>
          <input
            className="input"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            placeholder="AD 412"
          />
        </label>
        <label className="sb-field">
          <span>Until</span>
          <input
            className="input"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            placeholder="AD 430"
          />
        </label>
      </div>

      {/*
        The confirmation. Relationships are directional, so saving one asserts a
        second fact; showing it spelled out is the difference between a helpful
        default and a surprise in the graph.
      */}
      {inversePreview && (
        <div className="sb-inverse-note">
          <label className="sb-check">
            <input
              type="checkbox"
              checked={createInverse}
              onChange={(e) => setCreateInverse(e.target.checked)}
            />
            Also record the reverse direction
          </label>
          <code className="sb-inverse-preview">{inversePreview}</code>
        </div>
      )}

      {error && <p className="sb-form-error">{error}</p>}

      <button type="submit" className="btn btn-primary sb-btn-sm" disabled={busy || !predicate}>
        {busy ? 'Saving…' : 'Save claim'}
      </button>
    </form>
  )
}

function labelOf(types: EntityTypeOption[], name: string): string {
  return types.find((t) => t.name === name)?.label ?? name
}
