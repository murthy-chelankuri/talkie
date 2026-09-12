import { describe, expect, it } from 'vitest'
import {
  EMPTY_CONTEXT,
  describeProjectContext,
  findForbiddenTerms,
  hasProjectContext
} from './projectContext'

function context(overrides = {}): Parameters<typeof describeProjectContext>[0] {
  return { ...EMPTY_CONTEXT, ...overrides }
}

describe('what the model is told about the demo', () => {
  it('says nothing at all when nothing has been said', () => {
    // An empty heading is an instruction with no content, which a model will try to satisfy.
    expect(describeProjectContext(EMPTY_CONTEXT)).toEqual([])
    expect(describeProjectContext(undefined)).toEqual([])
  })

  it('passes on the background in the words it was written in', () => {
    const written = 'Talkie records a browser session and narrates it. Clips are called clips.'

    expect(describeProjectContext(context({ background: written })).join('\n')).toContain(written)
  })

  it('says who is watching, which decides what can be assumed', () => {
    const lines = describeProjectContext(context({ audience: 'Developers evaluating it' })).join('\n')

    expect(lines).toContain('Who is watching: Developers evaluating it')
  })

  it('carries the tone through', () => {
    const lines = describeProjectContext(context({ tone: 'Plain and direct. No marketing.' })).join('\n')

    expect(lines).toContain('How it should sound: Plain and direct. No marketing.')
  })

  it('states the rules as rules, not as preferences', () => {
    const lines = describeProjectContext(context({ neverSay: ['pricing', 'roadmap'] })).join('\n')

    expect(lines).toMatch(/not preferences/i)
    expect(lines).toContain('- pricing')
    expect(lines).toContain('- roadmap')
  })

  it('ignores blank rules rather than forbidding the empty string', () => {
    const lines = describeProjectContext(context({ neverSay: ['  ', ''] })).join('\n')

    expect(lines).toBe('')
  })

  it('settles the conflict between what is written and what is on screen', () => {
    // Without this a model trusts the screenshot over the person who made the product.
    const lines = describeProjectContext(context({ background: 'x' })).join('\n')

    expect(lines).toMatch(/what is written here wins/i)
  })

  it('counts a demo with only rules as having context', () => {
    expect(hasProjectContext(context({ neverSay: ['pricing'] }))).toBe(true)
    expect(hasProjectContext(context({ background: '   ' }))).toBe(false)
  })
})

describe('checking a draft against the rules', () => {
  it('finds a forbidden word', () => {
    expect(findForbiddenTerms('Our pricing starts low.', ['pricing'])).toEqual(['pricing'])
  })

  it('does not care about capitals, because a rule is about the word', () => {
    expect(findForbiddenTerms('Pricing is simple.', ['pricing'])).toEqual(['pricing'])
  })

  it('does not fire on a word that merely contains it', () => {
    // "beta" must not match "betamax", or the warning becomes noise and gets ignored.
    expect(findForbiddenTerms('We tested it on a Betamax.', ['beta'])).toEqual([])
  })

  it('finds it next to punctuation, where it usually sits', () => {
    expect(findForbiddenTerms('It is in beta.', ['beta'])).toEqual(['beta'])
    expect(findForbiddenTerms('(beta)', ['beta'])).toEqual(['beta'])
  })

  it('handles a phrase, not just a word', () => {
    expect(findForbiddenTerms('Compared to Acme Corp, it is faster.', ['Acme Corp'])).toEqual([
      'Acme Corp'
    ])
  })

  it('reports every rule that was broken', () => {
    const found = findForbiddenTerms('Our pricing and roadmap are public.', ['pricing', 'roadmap'])

    expect(found).toEqual(['pricing', 'roadmap'])
  })

  it('says nothing when the draft is clean', () => {
    expect(findForbiddenTerms('It records a session and narrates it.', ['pricing'])).toEqual([])
  })

  it('is not confused by a rule containing regular expression characters', () => {
    expect(findForbiddenTerms('Ask about cost (a lot).', ['cost (a lot)'])).toEqual(['cost (a lot)'])
  })

  it('has nothing to say when no rules were given', () => {
    expect(findForbiddenTerms('Anything at all.', [])).toEqual([])
  })
})
