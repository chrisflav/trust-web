/**
 * Which exported index this page is reading, and where it comes from.
 *
 * Two kinds, because there are two ways an index reaches a browser.  One is
 * served beside this bundle — `trust export --out public/index` writes it, the
 * deployment bind-mounts it, and it is the arrangement the frontend has always
 * had.  The other is published by CI to a branch of the library's own
 * repository and read from `raw.githubusercontent.com`, which is what lets a
 * reader look at a development nobody deployed anything for.
 *
 * The remote kind is a branch rather than the workflow artifact the action
 * uploads, and that is not a preference.  Downloading an artifact requires a
 * token with the `repo` scope even when the repository is public, so a page
 * that read artifacts directly would have to ask every reader for full control
 * of their private repositories in order to show them a public dependency
 * graph.  A branch is anonymous, and `raw.githubusercontent.com` serves it with
 * `Access-Control-Allow-Origin: *` and gzip — so the reader below fetches it
 * with exactly the code that reads a local one, lazy code shards and all.
 *
 * What it costs: only repositories that publish can be read this way.  There is
 * no third option — GitHub gates artifact bytes behind a credential, and with
 * no server of our own there is nowhere to keep one that is not the reader's.
 */

/** Where `raw.githubusercontent.com` serves a repository's branch from. */
const RAW = 'https://raw.githubusercontent.com'

/** Indexes served beside this bundle, as the deployment's nginx mounts them. */
const LOCAL_BASE = '/index'

/**
 * The branch `chrisflav/trust-action` pushes an index to.
 *
 * A constant rather than a setting, so that a repository name is enough to find
 * an index: a reader who has to know the branch as well has to be told, and
 * then the picker is not a picker.
 */
export const DEFAULT_BRANCH = 'trust-index'

/**
 * There is no default index.
 *
 * A bare URL used to read `mathlib`, which was right when a deployment served
 * one index it had exported itself.  With any repository readable, guessing is
 * worse than asking: it shows a library the reader did not choose and hides the
 * fact that the choice exists.  So `locationFromParams` returns `null` and the
 * page asks — see `IndexPicker`.
 */

export type IndexLocation =
  | { kind: 'local'; name: string }
  | { kind: 'github'; owner: string; repo: string; branch: string; name: string }

/**
 * The directory the index's own directory sits in.
 *
 * Split from the name because that is the shape `StaticIndexSource.load` takes
 * — several indexes side by side under one root, selected by name — and it is
 * as true of a branch holding two exports as it is of `public/index`.
 */
export function indexRoot(location: IndexLocation): string {
  if (location.kind === 'local') return LOCAL_BASE
  return `${RAW}/${location.owner}/${location.repo}/${location.branch}`
}

/** The URL prefix every part of an index hangs off: `meta.json`, `code/3.jsonl`. */
export function indexBase(location: IndexLocation): string {
  return `${indexRoot(location)}/${location.name}`
}

/** What to call this index in one line of chrome. */
export function describeLocation(location: IndexLocation): string {
  return location.kind === 'local' ? location.name : `${location.owner}/${location.repo}`
}

/** Where a reader would go to see the repository itself. */
export function repositoryUrl(location: IndexLocation): string | null {
  if (location.kind !== 'github') return null
  return `https://github.com/${location.owner}/${location.repo}`
}

const SEGMENT = /^[A-Za-z0-9._-]+$/

/**
 * Read what someone pasted.
 *
 * Accepts the forms a person actually has in hand: the repository's URL, the
 * `owner/repo` they would type from memory, and — because it is what the
 * published index's own URL looks like — a `/tree/<branch>/<name>` link
 * straight from the branch view.
 *
 * Returns `null` rather than throwing: this runs on every keystroke of the
 * picker, where "not yet a repository" is the ordinary state and not an error.
 */
export function parseGitHubLocation(input: string): IndexLocation | null {
  let text = input.trim()
  if (!text) return null

  text = text.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  if (text.startsWith('github.com/')) text = text.slice('github.com/'.length)
  // A clone URL is the one form that arrives with a suffix nobody means.
  text = text.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')

  const parts = text.split('/').filter((part) => part.length > 0)
  if (parts.length < 2) return null

  const [owner, repo, ...rest] = parts
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) return null

  let branch = DEFAULT_BRANCH
  // `trust export --repo <name>` names the directory, and the action defaults
  // that to the repository's name — so that is what to look for unless the URL
  // says otherwise.
  let name = repo

  if (rest.length > 0) {
    // `/tree/<branch>` and `/tree/<branch>/<name>`; anything else pasted from a
    // repository page (`/blob/…`, `/pull/…`) says nothing about an index, so the
    // defaults stand rather than being read out of a path that does not mean them.
    if (rest[0] === 'tree' && rest.length >= 2 && SEGMENT.test(rest[1])) {
      branch = rest[1]
      if (rest.length >= 3 && SEGMENT.test(rest[2])) name = rest[2]
    }
  }

  return { kind: 'github', owner, repo, branch, name }
}

/**
 * The index this page load is for, or `null` when the URL names none.
 *
 * The address bar decides, so that a link carries the index as well as the
 * declaration — which is the whole of what makes one of these shareable.
 */
export function locationFromParams(params: URLSearchParams): IndexLocation | null {
  const gh = params.get('gh')
  if (gh) {
    const parsed = parseGitHubLocation(gh)
    if (parsed && parsed.kind === 'github') {
      const branch = params.get('branch')
      const name = params.get('name')
      return {
        ...parsed,
        branch: branch && SEGMENT.test(branch) ? branch : parsed.branch,
        name: name && SEGMENT.test(name) ? name : parsed.name,
      }
    }
  }
  const repo = params.get('repo')
  return repo ? { kind: 'local', name: repo } : null
}

/** The parameters that bring this index back, to keep the address bar honest. */
export function paramsForLocation(location: IndexLocation): Record<string, string> {
  if (location.kind === 'local') return { repo: location.name }
  const params: Record<string, string> = { gh: `${location.owner}/${location.repo}` }
  // Only what differs from what `gh` alone would mean, so the common link stays
  // short enough to read.
  if (location.branch !== DEFAULT_BRANCH) params.branch = location.branch
  if (location.name !== location.repo) params.name = location.name
  return params
}

/** Whether two locations name the same index. */
export function sameLocation(a: IndexLocation, b: IndexLocation): boolean {
  return indexBase(a) === indexBase(b)
}

/* -------------------------------------------------------------------------- */
/* The index this session is reading                                          */
/* -------------------------------------------------------------------------- */

/**
 * What was picked, so that the question is asked once.
 *
 * `sessionStorage` rather than `localStorage`, and rather than nothing: a
 * reader who has chosen a library should not be asked again by every reload or
 * by following a link that carries no `?gh=`, and equally should not find a
 * choice made weeks ago still in force in a new window.  The address bar still
 * wins when it names an index — a shared link means the library it names.
 *
 * The durable list is `recentLocations`, which is a convenience rather than a
 * state: it makes re-picking one click without deciding anything on the
 * reader's behalf.
 */
const SESSION_KEY = 'trust.index'

export function sessionLocation(): IndexLocation | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isLocation(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function setSessionLocation(location: IndexLocation): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(location))
  } catch {
    /* private mode: the picker still works, it just asks again next reload */
  }
}

export function clearSessionLocation(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* nothing to do */
  }
}

/* -------------------------------------------------------------------------- */
/* Recently read indexes                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Nothing can enumerate the indexes that exist.
 *
 * `raw.githubusercontent.com` has no listing, and the deployment's `/index/`
 * is served with `try_files … =404` and no autoindex — so a picker cannot offer
 * a menu of what is out there, only of what this browser has already seen.
 * That is the reason this list exists at all.
 */
const RECENT_KEY = 'trust.recentIndexes'
const RECENT_LIMIT = 8

export function recentLocations(): IndexLocation[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Written by an older version, or by hand: keep what still parses and drop
    // the rest, rather than losing the list to one bad entry.
    return parsed.filter(isLocation).slice(0, RECENT_LIMIT)
  } catch {
    return []
  }
}

export function rememberLocation(location: IndexLocation): void {
  try {
    const next = [location, ...recentLocations().filter((seen) => !sameLocation(seen, location))]
    localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, RECENT_LIMIT)))
  } catch {
    /* private mode: the picker still works, it just offers no history */
  }
}

export function forgetLocation(location: IndexLocation): void {
  try {
    const next = recentLocations().filter((seen) => !sameLocation(seen, location))
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* nothing to do */
  }
}

function isLocation(value: unknown): value is IndexLocation {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (candidate.kind === 'local') return typeof candidate.name === 'string'
  if (candidate.kind === 'github') {
    return (
      typeof candidate.owner === 'string' &&
      typeof candidate.repo === 'string' &&
      typeof candidate.branch === 'string' &&
      typeof candidate.name === 'string'
    )
  }
  return false
}
