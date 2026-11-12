import { describe, expect, it } from 'vitest'
import { DriveAuthError, DriveNotFoundError } from '@/lib/google/errors'
import { ProviderError } from '@/lib/llm/errors'
import { ExtractionError } from '@/lib/llm/extract'
import { isProviderSettingsFailure } from './codes'
import { describeFailure } from './failure'

/**
 * The sentences a failed run is remembered by. Each must say what happened in
 * terms of something the reader can do — the code is for the program, the
 * message is for the detail pane.
 */
describe('describeFailure', () => {
  it('passes an extraction failure through, since its message is already written for a person', () => {
    const err = new ExtractionError('empty_response', 'The model returned an empty response.')
    expect(describeFailure(err)).toEqual({
      code: 'empty_response',
      message: 'The model returned an empty response.',
    })
  })

  it('names the provider state and keeps the provider’s own detail', () => {
    const failure = describeFailure(new ProviderError('unauthorized', 'Incorrect API key provided.', 401))
    expect(failure.code).toBe('unauthorized')
    expect(failure.message).toBe('Your provider rejected the API key. (Incorrect API key provided.)')
    expect(isProviderSettingsFailure(failure.code)).toBe(true)
  })

  it('says “later” for a rate limit with no retry-after', () => {
    expect(describeFailure(new ProviderError('rate_limited', '', 429)).message).toBe(
      'Your provider is rate limiting requests. Try again later.',
    )
  })

  it('rounds a long wait into minutes', () => {
    expect(describeFailure(new ProviderError('rate_limited', '', 429, 600)).message).toContain(
      'Try again in 10 minutes.',
    )
  })

  it('distinguishes Drive’s failures from the model’s', () => {
    expect(describeFailure(new DriveAuthError('invalid_grant')).code).toBe('drive_disconnected')
    expect(describeFailure(new DriveNotFoundError('f1')).code).toBe('drive_not_found')
    expect(isProviderSettingsFailure('drive_disconnected')).toBe(false)
  })

  it('never shows an unexpected error’s text, which may carry anything', () => {
    const failure = describeFailure(new Error('password=hunter2 at pg://…'))
    expect(failure.code).toBe('internal')
    expect(failure.message).not.toContain('hunter2')
  })
})
