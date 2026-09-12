import { describe, expect, it } from 'vitest'
import { EXPANDED_OPTIONS } from '../components/GraphView'
import {
  graphOptionsFromParams,
  paramsForView,
  reposFromParams,
  type ViewState,
} from './viewParams'

const BASE = { release: 'chrisflav/HodgeConjecture' }

const VIEW: ViewState = {
  decl: 'HodgeConjecture.hodgeConjecture',
  direction: 'dependencies',
  depth: 2,
  expanded: false,
  repos: new Set<string>(),
  options: EXPANDED_OPTIONS,
}

describe('reposFromParams', () => {
  it('is empty when nothing is named, which means all of them', () => {
    expect(reposFromParams(new URLSearchParams())).toEqual(new Set())
    expect(reposFromParams(new URLSearchParams('repos='))).toEqual(new Set())
  })

  it('reads a comma-separated list, trimmed', () => {
    expect(reposFromParams(new URLSearchParams('repos=Mathlib,core'))).toEqual(
      new Set(['Mathlib', 'core']),
    )
    expect(reposFromParams(new URLSearchParams('repos= Mathlib , core '))).toEqual(
      new Set(['Mathlib', 'core']),
    )
  })

  // The filter is applied by membership, so a name the index does not have
  // costs nothing; dropping it here would hide a typo instead of showing it.
  it('keeps names it cannot check', () => {
    expect(reposFromParams(new URLSearchParams('repos=NotAnIndex'))).toEqual(new Set(['NotAnIndex']))
  })
})

describe('graphOptionsFromParams', () => {
  it('falls back to the defaults when nothing is named', () => {
    const options = graphOptionsFromParams(new URLSearchParams(), EXPANDED_OPTIONS)
    expect(options.maxNodes).toBe(EXPANDED_OPTIONS.maxNodes)
    expect(options.maxEdges).toBe(EXPANDED_OPTIONS.maxEdges)
  })

  it('reads budgets from the link', () => {
    const options = graphOptionsFromParams(new URLSearchParams('nodes=900&edges=3000'), EXPANDED_OPTIONS)
    expect(options.maxNodes).toBe(900)
    expect(options.maxEdges).toBe(3000)
  })

  // A URL is typed and edited by people.  A budget that is not a positive
  // number would draw nothing at all, which reads as a broken index.
  it('ignores what is not a positive number', () => {
    for (const bad of ['0', '-1', 'abc', '', 'NaN', 'Infinity']) {
      const options = graphOptionsFromParams(new URLSearchParams(`nodes=${bad}`), EXPANDED_OPTIONS)
      expect(options.maxNodes, bad).toBe(EXPANDED_OPTIONS.maxNodes)
    }
  })

  it('leaves the cosmetic settings alone', () => {
    const options = graphOptionsFromParams(new URLSearchParams('nodes=900'), EXPANDED_OPTIONS)
    expect(options.nodeWidth).toBe(EXPANDED_OPTIONS.nodeWidth)
    expect(options.layerGap).toBe(EXPANDED_OPTIONS.layerGap)
  })
})

describe('paramsForView', () => {
  it('names the index before the declaration in it', () => {
    const params = paramsForView(BASE, VIEW, EXPANDED_OPTIONS)
    expect([...params.keys()].slice(0, 2)).toEqual(['release', 'decl'])
  })

  it('writes nothing for the defaults, so the ordinary link stays short', () => {
    const params = paramsForView(BASE, VIEW, EXPANDED_OPTIONS)
    expect(params.has('repos')).toBe(false)
    expect(params.has('nodes')).toBe(false)
    expect(params.has('edges')).toBe(false)
    expect(params.has('graph')).toBe(false)
  })

  it('carries the filter and the budgets when they differ', () => {
    const params = paramsForView(
      BASE,
      {
        ...VIEW,
        expanded: true,
        repos: new Set(['core', 'Mathlib']),
        options: { ...EXPANDED_OPTIONS, maxNodes: 900, maxEdges: 3000 },
      },
      EXPANDED_OPTIONS,
    )
    expect(params.get('graph')).toBe('expanded')
    // Sorted, so that the same view is the same link however the chips were
    // clicked — otherwise two identical views produce two different links.
    expect(params.get('repos')).toBe('Mathlib,core')
    expect(params.get('nodes')).toBe('900')
    expect(params.get('edges')).toBe('3000')
  })

  it('round-trips: what is written is what is read back', () => {
    const view = {
      ...VIEW,
      depth: 12,
      direction: 'dependents' as const,
      repos: new Set(['Mathlib']),
      options: { ...EXPANDED_OPTIONS, maxNodes: 1500, maxEdges: 4200 },
    }
    const written = paramsForView(BASE, view, EXPANDED_OPTIONS)
    const read = new URLSearchParams(written.toString())

    expect(read.get('decl')).toBe(view.decl)
    expect(read.get('dir')).toBe('dependents')
    expect(Number(read.get('depth'))).toBe(12)
    expect(reposFromParams(read)).toEqual(view.repos)
    const options = graphOptionsFromParams(read, EXPANDED_OPTIONS)
    expect(options.maxNodes).toBe(1500)
    expect(options.maxEdges).toBe(4200)
  })
})
