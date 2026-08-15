import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearSessionLocation,
  DEFAULT_BRANCH,
  describeLocation,
  forgetLocation,
  indexBase,
  locationFromParams,
  paramsForLocation,
  parseGitHubLocation,
  recentLocations,
  rememberLocation,
  sameLocation,
  sessionLocation,
  setSessionLocation,
  type IndexLocation,
} from './indexLocation'

const FORMAL_SCHEMES: IndexLocation = {
  kind: 'github',
  owner: 'lana-agents',
  repo: 'formal-schemes',
  branch: DEFAULT_BRANCH,
  name: 'formal-schemes',
}

describe('parseGitHubLocation', () => {
  it('reads the forms a person has in hand', () => {
    for (const input of [
      'lana-agents/formal-schemes',
      'https://github.com/lana-agents/formal-schemes',
      'http://github.com/lana-agents/formal-schemes',
      'github.com/lana-agents/formal-schemes',
      'www.github.com/lana-agents/formal-schemes',
      'https://github.com/lana-agents/formal-schemes/',
      'https://github.com/lana-agents/formal-schemes.git',
      '  lana-agents/formal-schemes  ',
    ]) {
      expect(parseGitHubLocation(input), input).toEqual(FORMAL_SCHEMES)
    }
  })

  it('takes the branch and the index name from a /tree/ link', () => {
    expect(parseGitHubLocation('https://github.com/lana-agents/formal-schemes/tree/trust-index')).toEqual(
      FORMAL_SCHEMES,
    )
    expect(
      parseGitHubLocation('https://github.com/lana-agents/formal-schemes/tree/other/core'),
    ).toEqual({ ...FORMAL_SCHEMES, branch: 'other', name: 'core' })
  })

  it('ignores a path that says nothing about an index', () => {
    // A blob or a pull request URL is a repository the reader means and a path
    // they do not; the defaults are better than reading a branch out of it.
    expect(parseGitHubLocation('https://github.com/lana-agents/formal-schemes/pull/12')).toEqual(
      FORMAL_SCHEMES,
    )
    expect(
      parseGitHubLocation('https://github.com/lana-agents/formal-schemes/blob/master/README.md'),
    ).toEqual(FORMAL_SCHEMES)
  })

  it('rejects what is not a repository', () => {
    for (const input of ['', '   ', 'formal-schemes', 'https://github.com/lana-agents', 'a/b c']) {
      expect(parseGitHubLocation(input), input).toBeNull()
    }
  })
})

describe('indexBase', () => {
  it('serves a local index from beside the bundle', () => {
    expect(indexBase({ kind: 'local', name: 'core' })).toBe('/index/core')
  })

  it('serves a published one from raw.githubusercontent.com', () => {
    expect(indexBase(FORMAL_SCHEMES)).toBe(
      'https://raw.githubusercontent.com/lana-agents/formal-schemes/trust-index/formal-schemes',
    )
  })
})

describe('locationFromParams', () => {
  it('names no index when the URL names none, so the page can ask', () => {
    expect(locationFromParams(new URLSearchParams())).toBeNull()
  })

  it('still reads ?repo=, so old links keep working', () => {
    expect(locationFromParams(new URLSearchParams('repo=core'))).toEqual({
      kind: 'local',
      name: 'core',
    })
  })

  it('reads ?gh=, with the branch and name overridable', () => {
    expect(locationFromParams(new URLSearchParams('gh=lana-agents/formal-schemes'))).toEqual(
      FORMAL_SCHEMES,
    )
    expect(
      locationFromParams(new URLSearchParams('gh=lana-agents/formal-schemes&branch=x&name=y')),
    ).toEqual({ ...FORMAL_SCHEMES, branch: 'x', name: 'y' })
  })

  it('asks rather than guessing when ?gh= is not a repository', () => {
    expect(locationFromParams(new URLSearchParams('gh=nonsense'))).toBeNull()
  })

  it('round-trips through the address bar', () => {
    for (const location of [
      { kind: 'local', name: 'core' } as IndexLocation,
      FORMAL_SCHEMES,
      { ...FORMAL_SCHEMES, branch: 'other' } as IndexLocation,
      { ...FORMAL_SCHEMES, name: 'core' } as IndexLocation,
    ]) {
      const params = new URLSearchParams(paramsForLocation(location))
      expect(locationFromParams(params), JSON.stringify(location)).toEqual(location)
    }
  })

  it('leaves out what the defaults already say', () => {
    expect(paramsForLocation(FORMAL_SCHEMES)).toEqual({ gh: 'lana-agents/formal-schemes' })
  })
})

describe('describeLocation', () => {
  it('names a remote index by its repository', () => {
    expect(describeLocation(FORMAL_SCHEMES)).toBe('lana-agents/formal-schemes')
    expect(describeLocation({ kind: 'local', name: 'core' })).toBe('core')
  })
})

describe('recently read indexes', () => {
  // vitest runs in node, where there is no localStorage.  The module treats its
  // absence as "no history", so a stub is what makes the history testable.
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    }
  })

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it('keeps the newest first and does not repeat one', () => {
    rememberLocation(FORMAL_SCHEMES)
    rememberLocation({ kind: 'local', name: 'core' })
    rememberLocation(FORMAL_SCHEMES)
    expect(recentLocations()).toEqual([FORMAL_SCHEMES, { kind: 'local', name: 'core' }])
  })

  it('forgets one', () => {
    rememberLocation(FORMAL_SCHEMES)
    forgetLocation(FORMAL_SCHEMES)
    expect(recentLocations()).toEqual([])
  })

  it('survives a corrupted list rather than losing it', () => {
    store.set('trust.recentIndexes', '{"not":"an array"}')
    expect(recentLocations()).toEqual([])
    store.set('trust.recentIndexes', JSON.stringify([{ kind: 'nonsense' }, FORMAL_SCHEMES]))
    expect(recentLocations()).toEqual([FORMAL_SCHEMES])
  })

  it('caps the list', () => {
    for (let i = 0; i < 12; i++) rememberLocation({ kind: 'local', name: `index-${i}` })
    expect(recentLocations()).toHaveLength(8)
    expect(recentLocations()[0]).toEqual({ kind: 'local', name: 'index-11' })
  })
})

describe('the index this session is reading', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    ;(globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    }
  })

  afterEach(() => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage
  })

  it('has none until one is picked', () => {
    expect(sessionLocation()).toBeNull()
  })

  it('remembers the pick, and forgets it when cleared', () => {
    setSessionLocation(FORMAL_SCHEMES)
    expect(sessionLocation()).toEqual(FORMAL_SCHEMES)
    clearSessionLocation()
    expect(sessionLocation()).toBeNull()
  })

  it('treats a corrupted entry as no choice rather than throwing', () => {
    store.set('trust.index', 'not json')
    expect(sessionLocation()).toBeNull()
    store.set('trust.index', JSON.stringify({ kind: 'nonsense' }))
    expect(sessionLocation()).toBeNull()
  })

  it('survives a browser that refuses storage', () => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage
    expect(sessionLocation()).toBeNull()
    expect(() => setSessionLocation(FORMAL_SCHEMES)).not.toThrow()
  })
})

describe('sameLocation', () => {
  it('compares what is actually fetched', () => {
    expect(sameLocation(FORMAL_SCHEMES, { ...FORMAL_SCHEMES })).toBe(true)
    expect(sameLocation(FORMAL_SCHEMES, { ...FORMAL_SCHEMES, branch: 'other' })).toBe(false)
  })
})
