import { describe, expect, it } from 'vitest'
import {
  closestNames,
  coreOntology,
  describeVocabulary,
  extractionJsonSchema,
  parseExtraction,
} from './extraction'
import { ATTRIBUTES, RELATIONSHIPS, deriveOntology } from './registry'

const ontology = coreOntology()

/** A well-formed claim, so each test can vary exactly one thing. */
const claim = (over: Record<string, unknown> = {}) => ({
  claims: [
    {
      subject: 'Ashfall',
      subject_type: 'settlement',
      predicate: 'ruled_by',
      object: 'Sera',
      object_type: 'character',
      quote: 'Ashfall has bowed to Sera since the year of ash.',
      ...over,
    },
  ],
})

const only = (input: unknown) => {
  const result = parseExtraction(input, ontology)
  return { ...result, first: result.claims[0], rejection: result.rejections[0] }
}

describe('accepting good output', () => {
  it('translates a relationship into the matcher’s shape', () => {
    const { claims, rejections, first } = only(claim())

    expect(rejections).toEqual([])
    expect(claims).toHaveLength(1)
    expect(first).toMatchObject({
      subjectName: 'Ashfall',
      subjectType: 'settlement',
      predicate: 'ruled_by',
      objectName: 'Sera',
      objectType: 'character',
      quote: 'Ashfall has bowed to Sera since the year of ash.',
    })
    // Names, not ids — resolving those is the entity matcher's job.
    expect(first).not.toHaveProperty('subjectId')
  })

  it('routes an attribute into the column its predicate declares', () => {
    const { first } = only(claim({ predicate: 'population', object: undefined, object_type: undefined, value: 12000 }))
    expect(first).toMatchObject({ valueInt: 12000 })
    expect(first?.valueString).toBeUndefined()
  })

  it('accepts a quoted number, because models produce them constantly', () => {
    const { first } = only(claim({ predicate: 'population', object: undefined, object_type: undefined, value: '12,000' }))
    expect(first?.valueInt).toBe(12000)
  })

  it('derives sort keys from date labels', () => {
    const { first } = only(claim({ start_time: 'AD 412', end_time: 'month 4, AD 430' }))
    expect(first?.startTime).toBe('AD 412')
    expect(first?.startOrder).toBe(411)
    expect(first?.endOrder).toBeGreaterThan(429)
  })

  it('keeps an unreadable date as an unordered label rather than rejecting it', () => {
    const { rejections, first } = only(claim({ start_time: 'the winter after the Sundering' }))
    expect(rejections).toEqual([])
    expect(first?.startTime).toBe('the winter after the Sundering')
    expect(first?.startOrder).toBeUndefined()
  })

  it('takes a bare array as well as { claims: [...] }', () => {
    expect(parseExtraction(claim().claims, ontology).claims).toHaveLength(1)
  })
})

describe('rejecting bad output', () => {
  it('rejects an invented predicate', () => {
    const { claims, rejection } = only(claim({ predicate: 'governs' }))

    expect(claims).toEqual([])
    expect(rejection?.code).toBe('unknown_predicate')
    expect(rejection?.message).toMatch(/not in the vocabulary/)
  })

  it('suggests the real predicate behind a typo', () => {
    const { rejection } = only(claim({ predicate: 'ruledby' }))
    expect(rejection?.message).toMatch(/ruled_by/)
  })

  /**
   * 'governs' is a real concept the vocabulary lacks, not a misspelling. The
   * nearest strings to it are 'owns' and 'power'; naming those would steer the
   * model onto a wrong-but-legal predicate, and nothing downstream would ever
   * catch that.
   */
  it('offers nothing when the nearest names are only nearest by spelling', () => {
    const { rejection } = only(claim({ predicate: 'governs' }))
    expect(rejection?.message).not.toMatch(/owns|power|contains/)
    expect(rejection?.message).toMatch(/do not substitute a near-synonym/)
  })

  it('rejects an illegal subject type and names the legal ones', () => {
    const { rejection } = only(claim({ subject: 'Bronze Crown', subject_type: 'artifact' }))
    expect(rejection?.code).toBe('illegal_subject_type')
    expect(rejection?.message).toMatch(/settlement/)
  })

  it('rejects an illegal object type', () => {
    const { rejection } = only(
      claim({ predicate: 'located_in', object: 'Sera', object_type: 'character' }),
    )
    expect(rejection?.code).toBe('illegal_object_type')
    expect(rejection?.message).toMatch(/region/)
  })

  it('rejects an unknown entity type', () => {
    const { rejection } = only(claim({ subject_type: 'starship' }))
    expect(rejection?.code).toBe('unknown_entity_type')
    expect(rejection?.message).toMatch(/settlement/)
  })

  it('rejects a relationship given a value', () => {
    const { rejection } = only(claim({ object: undefined, object_type: undefined, value: 'Sera' }))
    expect(rejection?.code).toBe('wrong_shape')
    expect(rejection?.message).toMatch(/relationship/)
  })

  it('rejects an attribute given an object', () => {
    const { rejection } = only(claim({ predicate: 'population' }))
    expect(rejection?.code).toBe('wrong_shape')
    expect(rejection?.message).toMatch(/attribute/)
  })

  it('rejects a claim carrying both an object and a value', () => {
    const { rejection } = only(claim({ value: 5 }))
    expect(rejection?.code).toBe('wrong_shape')
  })

  it('rejects text where a whole number is declared', () => {
    const { rejection } = only(
      claim({ predicate: 'population', object: undefined, object_type: undefined, value: 'many thousands' }),
    )
    expect(rejection?.code).toBe('wrong_value_type')
  })

  it('rejects a fraction where a whole number is declared', () => {
    const { rejection } = only(
      claim({ predicate: 'population', object: undefined, object_type: undefined, value: 1200.5 }),
    )
    expect(rejection?.code).toBe('wrong_value_type')
  })

  /** The one rule the database structurally cannot enforce. */
  it('rejects a value outside a predicate’s enum', () => {
    const { rejection } = only(
      claim({
        subject: 'Sera',
        subject_type: 'character',
        predicate: 'vital_status',
        object: undefined,
        object_type: undefined,
        value: 'undead',
      }),
    )
    expect(rejection?.code).toBe('value_not_in_enum')
    expect(rejection?.message).toMatch(/alive/)
  })

  it('rejects a self-relation', () => {
    const { rejection } = only(
      claim({ subject: 'Sera', subject_type: 'character', predicate: 'married_to', object: 'sera!', object_type: 'character' }),
    )
    expect(rejection?.code).toBe('self_relation')
  })

  it('refuses invented fields instead of dropping them', () => {
    const { rejection } = only(claim({ confidence_reason: 'seems right' }))
    expect(rejection?.code).toBe('malformed')
    expect(rejection?.message).toMatch(/confidence_reason/)
  })

  it('requires a quote', () => {
    const { rejection } = only(claim({ quote: '' }))
    expect(rejection?.code).toBe('malformed')
  })

  it('reports a wholly malformed response instead of throwing', () => {
    for (const input of [null, undefined, 42, 'nope', {}, { claims: 'lots' }]) {
      const result = parseExtraction(input, ontology)
      expect(result.claims).toEqual([])
      expect(result.rejections[0]?.code).toBe('malformed')
    }
  })
})

/**
 * The property that makes this layer worth having: the model is paid for once,
 * so one bad claim must not cost the other twenty-nine.
 */
describe('per-claim isolation', () => {
  it('keeps the good claims and reports only the bad ones, by position', () => {
    const good = claim().claims[0]!
    const result = parseExtraction(
      { claims: [good, { ...good, predicate: 'governs' }, { ...good, object: 'Kaine' }] },
      ontology,
    )

    expect(result.claims).toHaveLength(2)
    expect(result.rejections).toHaveLength(1)
    expect(result.rejections[0]!.index).toBe(1)
    expect(result.rejections[0]!.received).toMatchObject({ predicate: 'governs' })
  })
})

/**
 * The registry seeds the reference tables, drives this validator, and writes
 * the prompt. If those three ever disagree the failure is silent — the prompt
 * offers a predicate the validator rejects, and extraction just looks bad.
 */
describe('no drift between the registry, the validator and the prompt', () => {
  const { predicates, signatures } = deriveOntology()
  const vocabulary = describeVocabulary(ontology)

  it('compiles every predicate in the registry', () => {
    expect(ontology.predicateNames).toHaveLength(predicates.length)
    expect(new Set(ontology.predicateNames)).toEqual(new Set(predicates.map((p) => p.name)))
  })

  it('offers every predicate to the model', () => {
    for (const p of predicates) expect(vocabulary).toContain(p.name)
  })

  it('offers every entity type to the model', () => {
    for (const type of ontology.entityTypes) expect(vocabulary).toContain(type)
  })

  it('accepts every signature the registry declares', () => {
    for (const s of signatures) {
      const predicate = ontology.byName.get(s.predicate)!
      const base = {
        subject: 'A',
        subject_type: s.subjectType,
        predicate: s.predicate,
        quote: 'q',
      }
      const input =
        predicate.kind === 'relationship'
          ? { ...base, object: 'B', object_type: s.objectType }
          : { ...base, value: sampleValue(predicate.valueType!, predicate.valueEnum) }

      const result = parseExtraction({ claims: [input] }, ontology)
      expect(result.rejections, `${s.predicate}: ${s.subjectType} → ${s.objectType}`).toEqual([])
    }
  })

  it('puts every predicate in the JSON Schema the model is given', () => {
    const schema = extractionJsonSchema(ontology) as {
      properties: { claims: { items: { properties: { predicate: { enum: string[] } } } } }
    }
    const enumerated = schema.properties.claims.items.properties.predicate.enum
    expect(new Set(enumerated)).toEqual(new Set(ontology.predicateNames))
  })

  it('generates both directions of every relationship', () => {
    for (const rel of RELATIONSHIPS) {
      const forward = ontology.byName.get(rel.name)
      expect(forward, rel.name).toBeDefined()
      const inverseName = forward!.inverseName
      expect(inverseName, `${rel.name} has no inverse`).toBeTruthy()
      expect(ontology.byName.get(inverseName!)!.inverseName).toBe(rel.name)
    }
  })

  it('mirrors every relationship signature onto its inverse', () => {
    for (const rel of RELATIONSHIPS) {
      const inverseName = ontology.byName.get(rel.name)!.inverseName!
      for (const [subject, object] of rel.pairs) {
        expect(
          ontology.objects.get(`${inverseName}|${object}`),
          `${inverseName}: ${object} → ${subject}`,
        ).toContain(subject)
      }
    }
  })

  it('gives every attribute a value type and every relationship none', () => {
    for (const p of predicates) {
      if (p.kind === 'attribute') expect(p.valueType, p.name).toBeTruthy()
      else expect(p.valueType, p.name).toBeNull()
    }
    expect(predicates.filter((p) => p.kind === 'attribute')).toHaveLength(ATTRIBUTES.length)
  })
})

describe('suggestions', () => {
  it('finds the near-miss a model is most likely to produce', () => {
    expect(closestNames('ruledby', ontology.predicateNames)).toContain('ruled_by')
    expect(closestNames('populaton', ontology.predicateNames)).toContain('population')
    expect(closestNames('member-of', ontology.predicateNames)).toContain('member_of')
  })

  it('stays silent rather than reaching for a distant name', () => {
    expect(closestNames('governs', ontology.predicateNames)).toEqual([])
    expect(closestNames('conquered_by_dragons', ontology.predicateNames)).toEqual([])
  })
})

function sampleValue(valueType: string, values: string[] | null): string | number {
  if (values) return values[0]!
  if (valueType === 'int') return 1
  if (valueType === 'float') return 1.5
  if (valueType === 'date') return 'AD 412'
  return 'text'
}
