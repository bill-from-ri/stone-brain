import { describe, expect, it } from 'vitest'
import { ATTRIBUTES, RELATIONSHIPS, deriveOntology } from './registry'

/**
 * Cardinality is what Phase 3 reads to decide whether two claims can disagree
 * at all, so a flag on the wrong direction is not a cosmetic bug: it hides
 * every real contradiction on one side and invents one for every ordinary
 * one-to-many fact on the other. These pin the direction down per predicate.
 */
const { predicates } = deriveOntology()
const byName = new Map(predicates.map((p) => [p.name, p]))
const functional = (name: string) => byName.get(name)!.isFunctional

describe('which direction of a relationship is single-valued', () => {
  it.each([
    // A settlement has one ruler at a time; a ruler may hold many places.
    ['ruled_by', 'rules'],
    // An organisation has one head; one person may lead several.
    ['led_by', 'leads'],
    // A polity has one capital; a city can be the capital of more than one thing.
    ['has_capital', 'capital_of'],
  ])('%s is functional and %s is not', (single, many) => {
    expect(functional(single)).toBe(true)
    expect(functional(many)).toBe(false)
  })

  it.each([
    ['born_in', 'birthplace_of'],
    ['died_in', 'death_place_of'],
    ['resides_in', 'residence_of'],
    ['of_species', 'has_individual'],
  ])('%s is functional and %s is not', (single, many) => {
    expect(functional(single)).toBe(true)
    expect(functional(many)).toBe(false)
  })

  it('never marks both directions of one relationship', () => {
    for (const rel of RELATIONSHIPS) {
      const forward = byName.get(rel.name)!
      const inverse = forward.inverseName ? byName.get(forward.inverseName)! : forward
      if (inverse.name === forward.name) continue
      expect(forward.isFunctional && inverse.isFunctional, rel.name).toBe(false)
    }
  })

  it('keeps the deliberately many-valued relationships many-valued', () => {
    // Spouses: whether a second marriage contradicts the first is cultural.
    // Parents: a child has two. Founders and owners: shared as often as not.
    for (const name of [
      'married_to', 'parent_of', 'child_of', 'founded_by', 'owned_by', 'member_of', 'has_member',
      'located_in', 'contains',
    ]) {
      expect(functional(name), name).toBe(false)
    }
  })

  it('marks exactly the seven declared single-valued directions', () => {
    const marked = predicates.filter((p) => p.kind === 'relationship' && p.isFunctional)
    expect(marked.map((p) => p.name).sort()).toEqual(
      ['born_in', 'died_in', 'has_capital', 'led_by', 'of_species', 'resides_in', 'ruled_by'],
    )
    expect(RELATIONSHIPS.filter((r) => 'functional' in r)).toHaveLength(marked.length)
  })

  it('gives a symmetric relationship no direction to choose between', () => {
    for (const rel of RELATIONSHIPS) {
      if ('symmetric' in rel && rel.symmetric) expect('functional' in rel, rel.name).toBe(false)
    }
  })
})

describe('single-valued attributes', () => {
  it('are only closed sets and dates', () => {
    // A free-text attribute compares as text, so a paraphrase would read as a
    // contradiction. Only an enum or a date can be compared for real.
    for (const attr of ATTRIBUTES) {
      if (!('functional' in attr && attr.functional)) continue
      const closed = 'values' in attr && attr.values !== undefined
      expect(closed || attr.valueType === 'date', attr.name).toBe(true)
    }
  })

  it('carries the flag through derivation unchanged', () => {
    for (const attr of ATTRIBUTES) {
      expect(functional(attr.name), attr.name).toBe('functional' in attr && attr.functional === true)
    }
  })
})
