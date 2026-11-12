import { describe, expect, it } from 'vitest'
import { viewIssue } from './issues'

describe('viewIssue', () => {
  it('reads a validation rejection in the model’s wire format', () => {
    expect(
      viewIssue('validation', {
        subject: 'Andras',
        predicate: 'governs',
        object: 'Nephten',
        quote: 'Andras governs Nephten.',
        paragraph: 4,
      }),
    ).toEqual({
      subject: 'Andras',
      predicate: 'governs',
      object: 'Nephten',
      quote: 'Andras governs Nephten.',
      paragraph: 4,
    })
  })

  it('reads a write refusal in the validated shape, including a numeric value', () => {
    expect(
      viewIssue('write', { subjectName: 'Nephten', predicate: 'population', valueInt: 1200, quote: 'q' }),
    ).toMatchObject({ subject: 'Nephten', object: '1200', paragraph: null })
  })

  it('degrades rather than throws on whatever the model actually sent', () => {
    for (const received of [null, 'text', 42, [], { subject: '' }]) {
      expect(viewIssue('validation', received)).toEqual({
        subject: null,
        predicate: null,
        object: null,
        quote: null,
        paragraph: null,
      })
    }
  })
})
