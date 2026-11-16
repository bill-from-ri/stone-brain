import { describe, expect, it } from 'vitest'
import { type EntityIndex, buildEntityIndex, normalizeName, resolve } from './matcher'

/**
 * The entity names of the first hand-seeded document — names and spellings only,
 * which is all the matcher sees. The seed itself is private (see
 * src/lib/ontology/ground-truth.ts); this copy keeps the matcher tested against
 * a real naming population on a fresh clone.
 */
const SEED_ENTITIES: { name: string; type: string; variants?: string[] }[] = [
  { name: "Nevlos", type: 'region' },
  { name: "Elduin", type: 'region' },
  { name: "Frost Gulf", type: 'region' },
  { name: "Runara", type: 'region', variants: ["Frost Gulf"] },
  { name: "Enua", type: 'region', variants: ["Nethros"] },
  { name: "Zada Mountains", type: 'region' },
  { name: "Orosh Mountains", type: 'region' },
  { name: "Lagetan Basin", type: 'region' },
  { name: "Ipherian Sea", type: 'region' },
  { name: "Ipheria", type: 'region' },
  { name: "Merovia", type: 'region' },
  { name: "Agyros", type: 'region' },
  { name: "Ephria", type: 'region' },
  { name: "Southern Ephria", type: 'region' },
  { name: "Kovnia", type: 'region' },
  { name: "Akál", type: 'region', variants: ["Akali Archipelago"] },
  { name: "Sea of Akál", type: 'region' },
  { name: "Yeosin Frontier", type: 'region' },
  { name: "Central Plain", type: 'region' },
  { name: "Great Steppe", type: 'region' },
  { name: "Ipherian Empire", type: 'society' },
  { name: "Tavilaga", type: 'society' },
  { name: "Central Empire", type: 'society' },
  { name: "Syrath", type: 'character' },
  { name: "Vaski", type: 'character' },
  { name: "Doom", type: 'event' },
  { name: "Enu Conquests", type: 'event' },
  { name: "Dragon's Shroud", type: 'artifact' },
  { name: "Grain", type: 'commodity' },
  { name: "Dragon", type: 'species' },
  { name: "Giant", type: 'species' },
]

/**
 * The matcher's whole value is what it *refuses* to do, so most of these assert
 * a non-answer: ambiguity reported rather than resolved, near misses offered as
 * suggestions rather than returned as matches, and nothing ever written.
 */

let nextId = 0
const row = (name: string, entityType: string, variants: string[] = []) => ({
  id: `id-${++nextId}`,
  name,
  entityType,
  canonicity: 'canon' as const,
  normalizedName: normalizeName(name),
  nameVariants: variants,
})

/** The seeded world, as the matcher would see it after `db:seed:world`. */
const seededIndex: EntityIndex = buildEntityIndex(
  SEED_ENTITIES.map((e) => row(e.name, e.type, e.variants ?? [])),
)

describe('normalising', () => {
  it('folds case, punctuation and diacritics onto one key', () => {
    expect(normalizeName('Akál')).toBe('akal')
    expect(normalizeName('Sera.')).toBe('sera')
    expect(normalizeName("The Dragon's Shroud")).toBe('the dragon s shroud')
    expect(normalizeName('  Great   Steppe ')).toBe('great steppe')
  })

  it('collapses the forms an extractor actually varies', () => {
    const forms = ['Zada Mountains', 'zada mountains', 'ZADA  MOUNTAINS', 'Zada Mountains.']
    expect(new Set(forms.map(normalizeName)).size).toBe(1)
  })
})

describe('matching', () => {
  it('resolves an exact name without needing a type', () => {
    const result = resolve(seededIndex, 'Great Steppe')
    expect(result.status).toBe('matched')
    expect(result).toMatchObject({ entity: { name: 'Great Steppe', via: 'name' } })
  })

  it('resolves through a name variant', () => {
    const result = resolve(seededIndex, 'Nethros')
    expect(result).toMatchObject({ status: 'matched', entity: { name: 'Enua', via: 'variant' } })
  })

  it('resolves across a dropped leading article', () => {
    // Seeds store names without "The" (the naming convention), and documents
    // write "the Dragon's Shroud" — that must still find the stored entity.
    expect(resolve(seededIndex, "the Dragon's Shroud")).toMatchObject({
      status: 'matched',
      entity: { name: "Dragon's Shroud" },
    })
    // The other direction: a hand-entered name that kept its article.
    const withArticle = buildEntityIndex([row("The Dragon's Shroud", 'artifact', [])])
    expect(resolve(withArticle, "Dragon's Shroud")).toMatchObject({
      status: 'matched',
      entity: { name: "The Dragon's Shroud" },
    })
    expect(resolve(seededIndex, 'the Great Steppe')).toMatchObject({
      status: 'matched',
      entity: { name: 'Great Steppe' },
    })
  })

  it('counts an entity reachable by both its name and a variant as one entity', () => {
    const index = buildEntityIndex([row('Akál', 'region', ['Akal', 'Akál'])])
    expect(resolve(index, 'Akal')).toMatchObject({ status: 'matched', entity: { name: 'Akál' } })
  })
})

describe('ambiguity is reported, never resolved', () => {
  /**
   * The live case from the first seed: the document uses "Frost Gulf" for both
   * the bay and the forested land around it, which is stored as Runara with
   * "Frost Gulf" as a variant. Exactly what the dropped unique index (ADR §15)
   * would have made unrepresentable.
   */
  it('returns both entities behind "Frost Gulf"', () => {
    const result = resolve(seededIndex, 'Frost Gulf')

    expect(result.status).toBe('ambiguous')
    if (result.status !== 'ambiguous') throw new Error('unreachable')
    expect(result.candidates.map((c) => c.name).sort()).toEqual(['Frost Gulf', 'Runara'])
    // The `via` is what lets a UI say "Runara (also known as Frost Gulf)".
    expect(result.candidates.find((c) => c.name === 'Runara')?.via).toBe('variant')
  })

  it('stays ambiguous even when a type is given, if the type does not separate them', () => {
    // Both are regions, so the type narrows nothing.
    expect(resolve(seededIndex, 'Frost Gulf', { type: 'region' }).status).toBe('ambiguous')
  })

  it('resolves when the type does separate them', () => {
    const index = buildEntityIndex([row('Ashfall', 'settlement'), row('Ashfall', 'region')])

    expect(resolve(index, 'Ashfall').status).toBe('ambiguous')
    expect(resolve(index, 'Ashfall', { type: 'settlement' })).toMatchObject({
      status: 'matched',
      entity: { entityType: 'settlement' },
    })
  })

  it('reports two same-typed entities sharing a name rather than choosing', () => {
    const index = buildEntityIndex([row('Sera', 'character'), row('Sera', 'character')])
    const result = resolve(index, 'Sera', { type: 'character' })

    expect(result.status).toBe('ambiguous')
    if (result.status !== 'ambiguous') throw new Error('unreachable')
    expect(result.candidates).toHaveLength(2)
  })
})

describe('misses', () => {
  it('finds nothing for a name that is not there', () => {
    const result = resolve(seededIndex, 'Winterfell')
    expect(result).toMatchObject({ status: 'none' })
  })

  it('offers a near miss as a suggestion, never as a match', () => {
    const result = resolve(seededIndex, 'Great Steppes')

    expect(result.status).toBe('none')
    if (result.status !== 'none') throw new Error('unreachable')
    expect(result.suggestions[0]).toMatchObject({ name: 'Great Steppe', reason: 'near_miss' })
  })

  it('says the name exists under another type, which is the more useful answer', () => {
    const result = resolve(seededIndex, 'Syrath', { type: 'religion' })

    expect(result.status).toBe('none')
    if (result.status !== 'none') throw new Error('unreachable')
    expect(result.suggestions[0]).toMatchObject({ name: 'Syrath', entityType: 'character', reason: 'other_type' })
  })

  it('stays silent rather than reaching for a distant name', () => {
    const result = resolve(seededIndex, 'Qarth')
    expect(result).toMatchObject({ status: 'none', suggestions: [] })
  })

  it('treats an empty or punctuation-only name as a miss, not a crash', () => {
    for (const name of ['', '   ', '...']) {
      expect(resolve(seededIndex, name)).toEqual({ status: 'none', suggestions: [] })
    }
  })
})

describe('the seeded world resolves as authored', () => {
  it('finds every seeded entity by its own name', () => {
    const unresolvable = SEED_ENTITIES.filter((e) => {
      const result = resolve(seededIndex, e.name, { type: e.type })
      return result.status !== 'matched'
    }).map((e) => e.name)

    // "Frost Gulf" is the deliberate exception: it is also Runara's variant.
    expect(unresolvable).toEqual(['Frost Gulf'])
  })

  it('finds every declared variant', () => {
    for (const entity of SEED_ENTITIES) {
      for (const variant of entity.variants ?? []) {
        const result = resolve(seededIndex, variant, { type: entity.type })
        // Either it lands on the entity, or it is honestly ambiguous.
        if (result.status === 'matched') expect(result.entity.name).toBe(entity.name)
        else expect(result.status).toBe('ambiguous')
      }
    }
  })
})
