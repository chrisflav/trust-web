import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StaticIndexSource, filterSource, type Accept, type GraphSource, type LoadProgress } from './data/source'
import type { Decl, DeclCode, NodeId } from './data/types'
import { CodeView } from './components/CodeView'
import { DepsTree, type Direction } from './components/DepsTree'
import { GraphView } from './components/GraphView'
import { ExpandedGraph } from './components/ExpandedGraph'
import { KindBadge } from './components/KindBadge'
import { MarksPanel, type MarksEdit } from './components/MarksPanel'
import { indexMarks, loadMarks, saveMarks, emptyMarks, type MarksIndex } from './data/marks'
import { pathTo, trustedCutSource } from './data/trustedMode'
import { WhoTrusts } from './components/WhoTrusts'
import { FollowPanel } from './components/FollowPanel'
import { ServerPicker } from './components/ServerPicker'
import { IndexDialog, IndexPicker } from './components/IndexPicker'
import { EXPANDED_OPTIONS, type GraphOptions } from './components/GraphView'
import { beginReachableDepth } from './data/source'
import { graphOptionsFromParams, paramsForView, reposFromParams } from './data/viewParams'
import {
  asBranch,
  asRelease,
  indexBase,
  indexRoot,
  locationFromParams,
  paramsForLocation,
  rememberLocation,
  sessionLocation,
  setSessionLocation,
} from './data/indexLocation'
import {
  claimFor,
  currentIdentity,
  hasServer,
  publish,
  revoke,
  trustList,
  trustedVouches,
  type FollowedKey,
  type Identity,
  type Vouch,
} from './data/certificates'
import { closeIsBack, navState, nextNav, readNav, sameEntry, type NavState } from './data/navigation'
import type { PreviewTrust, TrustedBy } from './components/NodePreview'
import { defaultHidden, loadHidden, saveHidden, type HiddenConfig } from './data/hidden'

/** Initial view state, so that a particular declaration can be linked to. */
const params = new URLSearchParams(window.location.search)
/**
 * Which exported index to read, and where from.
 *
 * `trust export --repo <name>` writes one directory per repository, so several
 * sit side by side under one root and the name chooses between them —
 * `?repo=core` for the Lean core export, the default for Mathlib.  `?gh=` reads
 * one a library published from its own CI instead; see `data/indexLocation`.
 */
/**
 * The address bar first, then what this session already picked, then nobody:
 * a link that names an index means that index, a reader who has chosen one is
 * not asked again, and a first visit is asked rather than guessed at.
 */
const LOCATION = locationFromParams(params) ?? sessionLocation()
const INITIAL_DECL = params.get('decl') ?? 'Nat.gcd'
const INITIAL_DIRECTION: Direction = params.get('dir') === 'dependents' ? 'dependents' : 'dependencies'
const INITIAL_DEPTH = Number(params.get('depth') ?? 2)
const INITIAL_REPOS = reposFromParams(params)
const INITIAL_GRAPH_OPTIONS = graphOptionsFromParams(params, EXPANDED_OPTIONS)

/**
 * What the depth controls allow before the real answer arrives.
 *
 * The fixed maximum they both used to have, kept for the moment between opening
 * a declaration and its closure being counted — long enough to matter on a
 * Mathlib-sized one, and a number the reader could already reach.
 */
const PROVISIONAL_DEPTH = 8

/** Byte counts, at the resolution a progress line can usefully show. */
function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function App() {
  const [source, setSource] = useState<GraphSource | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState(INITIAL_DECL)
  const [root, setRoot] = useState<NodeId | null>(null)
  /** Highlighted node.  A graph click moves this; only a focus moves `root`. */
  const [selected, setSelected] = useState<NodeId | null>(null)
  /**
   * Whether the selection came from a click rather than from navigating.
   *
   * Focusing sets the selection to the new root, and dimming the graph the
   * moment it appears would answer a question nobody asked; the dimming is a
   * response to picking a node, so it only follows a pick.
   */
  const [picked, setPicked] = useState(false)
  /**
   * Where the browser thinks we are, mirrored so the back button can render.
   *
   * The stack itself is the browser's — see `data/navigation` — and this is
   * only the entry it is currently on, kept in state because whether the button
   * is disabled and where it says it goes are read off it.
   */
  const [nav, setNav] = useState<NavState | null>(() =>
    typeof window === 'undefined' ? null : readNav(window.history.state),
  )
  /**
   * On by default: the question `trust` exists to answer is what a statement
   * still rests on that you have *not* accepted, so tracing past your own
   * judgements is the exception rather than the rule.
   */
  const [upToTrusted, setUpToTrusted] = useState(true)
  /** The full-screen graph, off unless asked for and remembered in the URL. */
  const [expanded, setExpanded] = useState(params.get('graph') === 'expanded')
  const [direction, setDirection] = useState<Direction>(INITIAL_DIRECTION)
  const [depth, setDepth] = useState(INITIAL_DEPTH)
  const [repoFilter, setRepoFilter] = useState<Set<string>>(INITIAL_REPOS)
  const [graphOptions, setGraphOptions] = useState<GraphOptions>(INITIAL_GRAPH_OPTIONS)

  // How deep this declaration actually goes, which is what both depth controls
  // stop at — the inline one and the expanded view's, which share `depth` and
  // must therefore share a ceiling or disagree about what the value means.
  //
  // Counted off the unfiltered source on purpose: the filters hide parts of the
  // graph, and a ceiling that moved when a repository was unticked would read
  // as the control breaking rather than as the view changing.  A large closure
  // resolves in slices, so until it lands the ceiling is the old fixed 8.
  const [reach, setReach] = useState<{ depth: number; complete: boolean } | null>(null)
  useEffect(() => {
    if (!source || root === null) return
    setReach(null)
    const begun = beginReachableDepth(source, root, direction)
    if (begun.done) {
      setReach({ depth: begun.size.depth, complete: begun.size.complete })
      return
    }
    let cancelled = false
    begun.rest(() => cancelled).then((size) => {
      if (!cancelled && size) setReach({ depth: size.depth, complete: size.complete })
    })
    return () => {
      cancelled = true
    }
  }, [source, root, direction])

  // Never below where the control already is: a link shared at depth 12 must
  // not be clamped to 4 by a count that has not finished, or by one that
  // stopped at its work budget.
  const maxDepth = Math.max(1, depth, reach?.depth ?? PROVISIONAL_DEPTH)
  const [code, setCode] = useState<DeclCode | null>(null)
  const [progress, setProgress] = useState<LoadProgress | null>(null)
  const [marks, setMarks] = useState<MarksIndex>(() => indexMarks(emptyMarks, false))
  /** Personal, not shared: kept in this browser rather than in the marks file. */
  const [hidden, setHidden] = useState<HiddenConfig>(() =>
    typeof window === 'undefined' ? defaultHidden : loadHidden(),
  )
  /** Who you are on the certificate server, and whose certificates you count. */
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [following, setFollowing] = useState<Set<string>>(new Set())
  /** Keys you follow — the half of a trust list that survives federation. */
  const [followingKeys, setFollowingKeys] = useState<FollowedKey[]>([])
  /** What you trust by certificate, and who vouched for each: yours included. */
  const [federated, setFederated] = useState<Map<string, Vouch[]>>(new Map())
  /** The trust list, shown on demand rather than taking up the header. */
  const [showFollows, setShowFollows] = useState(false)

  // Loading an index is tens of megabytes and one worker.  `StrictMode` runs
  // effects twice in development, which downloaded and built the whole thing
  // twice over; the guard makes the load happen once per page instead.
  const loadStarted = useRef(false)

  /**
   * Whether a history traversal we asked for is still on its way.
   *
   * `history.back()` is queued, not immediate: until `popstate` lands the
   * expanded graph is still mounted and still listening for Escape, so a second
   * press went back a second time and left the reader two steps away — out of
   * the graph *and* off the declaration they opened it from.
   */
  const leaving = useRef(false)

  useEffect(() => {
    if (loadStarted.current || !LOCATION) return
    loadStarted.current = true
    // Marks are small and independent of the index, so a failure to load them
    // must not stop the graph from coming up.
    loadMarks(indexBase(LOCATION))
      .then(setMarks)
      .catch(() => {})
    StaticIndexSource.load(indexRoot(LOCATION), LOCATION.name, setProgress, LOCATION.kind === 'release')
      .then((loaded) => {
        setSource(loaded)
        // Both only once it has loaded.  A repository that turned out to
        // publish nothing is not one to offer back as somewhere the reader has
        // been, and pinning it to the session would make a mistyped `?gh=`
        // stick to every later reload.
        rememberLocation(LOCATION)
        setSessionLocation(LOCATION)
        // Prefer an exact name: `?decl=Eq` must land on `Eq`, not on some
        // longer declaration that merely contains it.
        const initial = loaded.findByName(INITIAL_DECL) ?? loaded.search(INITIAL_DECL, 1)[0]?.id
        if (initial !== undefined && initial !== null) {
          setRoot(initial)
          setSelected(initial)
        }
      })
      .catch((e) => setError(String(e)))
  }, [])

  /**
   * Refresh who you are, whom you follow, and what they vouch for.
   *
   * All three fail soft: the certificate server being absent or down leaves the
   * index perfectly usable, which is the point of it being a static export.
   */
  const refreshFederation = useCallback(async () => {
    if (!hasServer()) return
    const me = await currentIdentity()
    setIdentity(me)
    if (!me) {
      setFollowing(new Set())
      setFollowingKeys([])
      setFederated(new Map())
      return
    }
    const [list, hashes] = await Promise.all([
      trustList(),
      trustedVouches(source?.meta().hasher ?? 'semantic-v1'),
    ])
    setFollowing(new Set(list.people.map((entry) => entry.login)))
    setFollowingKeys(list.keys)
    setFederated(hashes)
  }, [source])

  useEffect(() => {
    void refreshFederation()
  }, [refreshFederation])

  /**
   * Keep the address bar in step with the view, and the history with the reader.
   *
   * One place owns both, because they are one question: a change that takes the
   * reader somewhere else — another declaration, or into the full-screen graph —
   * is a history entry, and a change to how the same thing is being looked at
   * amends the entry they are on.  Doing it here rather than at each button
   * means nothing can navigate without the browser hearing about it, which is
   * what made the browser's back button disagree with ours in the first place.
   */
  useEffect(() => {
    if (!source || root === null || !LOCATION) return
    // The index is carried through so that a reload, or a shared link, stays on
    // the one the view is actually showing.
    const next = paramsForView(
      paramsForLocation(LOCATION),
      {
        decl: source.node(root).name,
        direction,
        depth,
        expanded,
        repos: repoFilter,
        options: graphOptions,
      },
      EXPANDED_OPTIONS,
    )
    const entry = { decl: source.node(root).name, expanded }
    const current = readNav(window.history.state)
    let state: NavState
    if (current === null || sameEntry(current, entry)) {
      // The first view of a page is where the reader already is, not somewhere
      // they went: pushing it would leave an entry behind us whose back button
      // goes to this same page before it had loaded anything.
      state = current ?? nextNav(null, entry)
      window.history.replaceState(navState(state), '', `?${next}`)
    } else {
      state = nextNav(current, entry)
      window.history.pushState(navState(state), '', `?${next}`)
    }
    setNav((previous) =>
      previous && previous.seq === state.seq && sameEntry(previous, state) ? previous : state,
    )
  }, [source, root, direction, depth, expanded, repoFilter, graphOptions])

  /**
   * The browser's back and forward buttons, which are now ours.
   *
   * Only the position is restored — the declaration, and whether the graph is
   * full screen.  The settings stay as they are, and the effect above writes
   * them straight back into the entry we landed on, so going back never quietly
   * moves a slider the reader has since set.
   */
  useEffect(() => {
    if (!source) return
    const onPop = (event: PopStateEvent) => {
      const state = readNav(event.state)
      if (!state) return
      // The traversal we may have asked for has arrived, whatever it was.
      leaving.current = false
      // Resolved before anything moves: an entry naming a declaration this
      // index does not have is not half-applied, or the view and the history
      // would disagree about where the reader is.
      const id = source.findByName(state.decl)
      if (id === null) return
      setNav(state)
      setExpanded(state.expanded)
      setRoot(id)
      setSelected(id)
      setPicked(false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [source])

  // Code shards are fetched lazily, so a stale response must not overwrite a
  // newer selection.
  useEffect(() => {
    if (!source || root === null) {
      setCode(null)
      return
    }
    let current = true
    setCode(null)
    source.code(root).then((loaded) => {
      if (current) setCode(loaded)
    })
    return () => {
      current = false
    }
  }, [source, root])

  const results = useMemo(() => (source ? source.search(query, 40) : []), [source, query])

  const hiddenNames = useMemo(() => new Set(hidden.names), [hidden.names])
  const isHidden = useCallback(
    (id: NodeId) => (source ? hiddenNames.has(source.node(id)?.name) : false),
    [hiddenNames, source],
  )
  const updateHidden = useCallback((next: HiddenConfig) => {
    setHidden(next)
    saveHidden(next)
  }, [])
  const hide = useCallback(
    (name: string) => {
      if (hidden.names.includes(name)) return
      updateHidden({ ...hidden, names: [...hidden.names, name] })
    },
    [hidden, updateHidden],
  )
  const unhide = useCallback(
    (name: string) => updateHidden({ ...hidden, names: hidden.names.filter((n) => n !== name) }),
    [hidden, updateHidden],
  )

  /**
   * Which declarations the views may show at all.
   *
   * The repository filter and the hidden list are the same operation, so they
   * are combined once here and applied to the source rather than re-derived by
   * each view.  Null means everything, which lets `filterSource` return the
   * index untouched instead of wrapping it in a predicate that always passes.
   */
  const accept = useMemo<Accept | null>(() => {
    const filtering = repoFilter.size > 0
    const hiding = hidden.active && hiddenNames.size > 0
    if (!source || (!filtering && !hiding)) return null
    return (id: NodeId) => {
      const decl = source.node(id)
      if (!decl) return false
      if (hiding && hiddenNames.has(decl.name)) return false
      return !filtering || repoFilter.has(source.repoOf(id))
    }
  }, [source, repoFilter, hidden.active, hiddenNames])

  /**
   * Trusted here, or vouched for by a certificate you count — yours included.
   *
   * Certificates widen exactly this predicate and nothing else — the cut, the
   * green background and "up to trusted" mode all read from it, so one from
   * somebody you follow behaves like a mark you made yourself.
   */
  const isTrusted = useCallback(
    (id: NodeId) => {
      if (!source) return false
      if (marks.trusted.has(source.node(id)?.name)) return true
      if (federated.size === 0) return false
      const hash = source.hashOf(id)
      return hash.length > 0 && federated.has(hash)
    },
    [marks, source, federated],
  )
  /**
   * The index the views traverse.
   *
   * In "up to trusted" mode this is the index seen through the marks: trusted
   * declarations are leaves and characterized ones stand in for their own
   * dependencies.  Everything else — search, code, names — is untouched, so
   * only the shape of the dependency relation changes.
   */
  const viewSource = useMemo(
    () => (source && upToTrusted ? trustedCutSource(source, marks, root, isTrusted) : source),
    [source, upToTrusted, marks, root, isTrusted],
  )

  /** What the tree walks: the mode applied, then the filters. */
  const treeSource = useMemo(
    () => (viewSource ? filterSource(viewSource, accept) : null),
    [viewSource, accept],
  )

  /** The route from the root to the highlighted node, so the tree can open it. */
  const revealPath = useMemo(() => {
    if (!viewSource || root === null || selected === null || selected === root) return null
    return pathTo(treeSource ?? viewSource, root, selected, direction)
  }, [treeSource, viewSource, root, selected, direction])

  const isCharacterized = useCallback(
    (id: NodeId) => (source ? marks.characterized.has(source.node(id)?.name) : false),
    [marks, source],
  )

  // Stable identities: these are props of memoised components, so recreating
  // them on every render would defeat the memoisation entirely.
  /**
   * Make `id` the root.
   *
   * Nothing is recorded here: the effect that owns the address bar sees the
   * root change and pushes the entry, which is why this takes no note of where
   * we were and why `StrictMode` running it twice costs nothing.
   */
  const focus = useCallback((id: NodeId) => {
    setRoot(id)
    setSelected(id)
    setPicked(false)
  }, [])

  /**
   * Back, in the only sense the browser has.
   *
   * The button no longer walks a stack of its own — it presses the browser's
   * back button, which fires `popstate` and lands in the handler above, so that
   * this button and the one in the chrome cannot come to mean different things.
   */
  const back = useCallback(() => window.history.back(), [])

  const focusName = useCallback(
    (name: string) => {
      if (!source) return
      const id = source.findByName(name)
      if (id !== null) focus(id)
    },
    [source, focus],
  )

  const isKnown = useCallback(
    (name: string) => (source ? source.findByName(name) !== null : false),
    [source],
  )

  const pick = useCallback((id: NodeId) => {
    setSelected(id)
    setPicked(true)
  }, [])


  const searchDecls = useCallback(
    (text: string, limit: number) => (source ? source.search(text, limit) : []),
    [source],
  )

  /**
   * Apply one edit to the marks and persist it.
   *
   * The whole file is written back each time rather than patched: it is a few
   * kilobytes, and the dev server merges the hash snapshots it owns, so a
   * whole-file write cannot lose anything the browser does not know about.
   */
  const editMarks = useCallback(
    async (change: MarksEdit) => {
      const current = marks.marks
      const next = {
        ...current,
        trusted: [...current.trusted],
        characterizations: [...current.characterizations],
        protectedDecls: [...current.protectedDecls],
      }
      switch (change.kind) {
        case 'trust':
          next.trusted = [
            ...next.trusted.filter((m) => m.name !== change.name),
            // Pinned to the revision this index was built from: a judgement
            // about a declaration only means anything against a version of it.
            { name: change.name, commit: source?.meta().rev ?? '', note: change.note },
          ]
          break
        case 'untrust':
          next.trusted = next.trusted.filter((m) => m.name !== change.name)
          break
        case 'protect':
          next.protectedDecls = [
            ...next.protectedDecls.filter((p) => p.name !== change.name),
            { name: change.name, note: change.note, status: 'unrecorded' },
          ]
          break
        case 'unprotect':
          next.protectedDecls = next.protectedDecls.filter((p) => p.name !== change.name)
          break
        case 'characterize':
          next.characterizations = [
            ...next.characterizations.filter((c) => c.definition !== change.definition),
            { definition: change.definition, theorems: change.theorems, note: change.note },
          ]
          break
        case 'uncharacterize':
          next.characterizations = next.characterizations.filter(
            (c) => c.definition !== change.definition,
          )
          break
      }
      await saveMarks(next)
      setMarks(indexMarks(next, true))
    },
    [marks, source],
  )

  /**
   * Who trusts a declaration, and on what basis.
   *
   * Both halves of the answer the views already act on: the mark recorded in
   * this index's marks file, and the certificates counted for it.  Nothing is
   * fetched — the certificates were all read in one request when the trust list
   * was — so a card can name them while the pointer is passing over a node.
   */
  const trustedBy = useCallback(
    (id: NodeId): TrustedBy => {
      if (!source) return { vouches: [] }
      const decl = source.node(id)
      const hash = source.hashOf(id)
      return {
        mark: decl ? marks.trusted.get(decl.name) : undefined,
        vouches: (hash.length > 0 ? federated.get(hash) : undefined) ?? [],
      }
    },
    [source, marks, federated],
  )

  /** Record or remove a mark, from wherever a declaration is on screen. */
  const markTrusted = useCallback(
    async (name: string, trusted: boolean) => {
      await editMarks(trusted ? { kind: 'trust', name, note: '' } : { kind: 'untrust', name })
    },
    [editMarks],
  )

  /**
   * Publish or withdraw a certificate for a declaration's content.
   *
   * Unsigned and unannotated, which is what a judgement made in passing over a
   * graph can honestly be; `WhoTrusts` is where a note and a signature belong,
   * and it is one double-click away.  The refresh afterwards is what turns the
   * node green, since the trusted set is the thing the views read.
   */
  const vouchFor = useCallback(
    async (id: NodeId, vouch: boolean) => {
      if (!source) return
      const hash = source.hashOf(id)
      if (hash.length === 0) return
      const done = vouch
        ? (await publish(claimFor({ name: source.node(id).name, hash }, source.meta()))) !== null
        : await revoke(hash)
      if (!done) throw new Error('the certificate server did not accept that — still signed in?')
      await refreshFederation()
    },
    [source, refreshFederation],
  )

  /**
   * What the graphs' hover cards may say and do.
   *
   * Assembled once, because it is a prop of a memoised component: a fresh
   * object per render would re-render every node in the drawing.
   */
  const preview = useMemo<PreviewTrust>(
    () => ({
      trustedBy,
      onMark: marks.editable ? markTrusted : undefined,
      onVouch: identity ? vouchFor : undefined,
    }),
    [trustedBy, marks.editable, markTrusted, identity, vouchFor],
  )

  // Nothing has been picked: a first visit, or a session that has not chosen.
  // The dialog is the page rather than something over it, and it cannot be
  // dismissed, because there is nothing behind it to dismiss it onto.
  if (!LOCATION) {
    return (
      <div className="app-message">
        <h1>trust</h1>
        <IndexDialog current={null} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="app-message">
        <h1>trust</h1>
        <p className="error">Could not load the index: {error}</p>
        {LOCATION.kind === 'github' ? (
          <p>
            {LOCATION.owner}/{LOCATION.repo} does not appear to publish one on its{' '}
            <code>{LOCATION.branch}</code> branch. A repository publishes an index by running{' '}
            <code>chrisflav/trust-action</code> in its CI — which can publish to a release
            instead, in which case{' '}
            <a href={`?${new URLSearchParams(paramsForLocation(asRelease(LOCATION)))}`}>
              read it as a release
            </a>
            .
          </p>
        ) : LOCATION.kind === 'release' ? (
          <p>
            {LOCATION.owner}/{LOCATION.repo} does not appear to publish one to a{' '}
            <code>{LOCATION.tag}</code> release. A repository publishes an index by running{' '}
            <code>chrisflav/trust-action</code> in its CI — which can publish to a branch
            instead, in which case{' '}
            <a href={`?${new URLSearchParams(paramsForLocation(asBranch(LOCATION)))}`}>
              read it as a branch
            </a>
            .
            {/*
              A deployment with no `/release/` proxy answers these with the SPA, so the
              failure looks like a missing index rather than a missing proxy.  Saying so
              here is cheaper than the reader working it out from a JSON parse error.
            */}{' '}
            A release is also only readable through a deployment that proxies release
            assets; a bare static copy of this frontend cannot fetch them at all.
          </p>
        ) : (
          <p>
            Generate one with <code>trust export --repo core --out public/index Init</code>.
          </p>
        )}
        <IndexPicker current={LOCATION} />
      </div>
    )
  }

  if (!source) {
    // Nothing interactive is rendered until the index is in hand, so the load
    // cannot be raced by a click; `aria-busy` says the same thing to a screen
    // reader, which would otherwise be told only that the page is empty.
    const percent =
      progress && progress.phase === 'fetch' && progress.total > 0
        ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
        : null
    return (
      <div className="app-message" role="status" aria-busy="true" aria-live="polite">
        <h1>trust</h1>
        <p>{progress?.phase === 'build' ? 'Building index…' : 'Downloading index…'}</p>
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
        >
          <div
            className={percent === null ? 'progress-fill indeterminate' : 'progress-fill'}
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </div>
        <p className="progress-detail">
          {percent === null
            ? 'This runs once per index; the page stays put until it is ready.'
            : `${formatBytes(progress!.loaded)} of ${formatBytes(progress!.total)} · ${percent}%`}
        </p>
        <IndexPicker current={LOCATION} />
      </div>
    )
  }

  const meta = source.meta()
  const rootDecl: Decl | null = root !== null ? source.node(root) : null

  const toggleRepo = (repo: string) => {
    const next = new Set(repoFilter)
    if (next.has(repo)) next.delete(repo)
    else next.add(repo)
    setRepoFilter(next)
  }

  /**
   * Leave the expanded graph the way the reader arrived at it.
   *
   * Opening it was a step, so closing it is a step back and goes through the
   * history — otherwise the browser would be left holding an entry for a view
   * that is no longer on screen, and its back button would re-open the graph
   * the reader had just closed.  Arriving on `?graph=expanded`, where there is
   * no step to undo, closes it in place instead.
   */
  const closeExpanded = () => {
    if (!closeIsBack(nav)) {
      setExpanded(false)
      return
    }
    // Once only: see `leaving`.  Escape is held in the graph's own listener,
    // which is still attached until the traversal actually lands.
    if (leaving.current) return
    leaving.current = true
    window.history.back()
  }

  if (expanded && rootDecl && root !== null) {
    return (
      <ExpandedGraph
        source={viewSource ?? source}
        root={root}
        rootName={rootDecl.name}
        direction={direction}
        depth={depth}
        selected={selected ?? root}
        onSelect={pick}
        onFocus={focus}
        dimUnconnected={picked}
        onDirection={setDirection}
        onDepth={setDepth}
        isTrusted={isTrusted}
        accept={accept ?? undefined}
        isHidden={isHidden}
        onHide={hide}
        onUnhide={unhide}
        preview={preview}
        repos={source.repos()}
        repoFilter={repoFilter}
        onRepoFilter={setRepoFilter}
        hidden={hidden}
        onHiddenChange={updateHidden}
        initialOptions={graphOptions}
        onOptions={setGraphOptions}
        maxDepth={maxDepth}
        reach={reach}
        onClose={closeExpanded}
      />
    )
  }

  return (
    <div className="app">
      <header>
        <h1>trust</h1>
        <IndexPicker current={LOCATION} />
        <div className="meta">
          {meta.repo} @ Lean {meta.toolchain} · {meta.declCount.toLocaleString()} declarations ·{' '}
          {meta.stmtEdgeCount.toLocaleString()} statement edges
        </div>
      </header>

      <div className="controls">
        <button
          className="back"
          disabled={!nav || nav.seq === 0}
          onClick={back}
          title={
            !nav || nav.seq === 0
              ? 'Nothing to go back to'
              : // The entry behind can be this same declaration, which is only
                // possible when it is the full-screen graph of it — naming the
                // declaration there would offer to go where the reader already
                // is.  Arriving on `?graph=expanded` and closing it is the way
                // to get there.
                nav.prev === nav.decl
                ? 'Back to the full-screen graph'
                : `Back to ${nav.prev ?? 'the previous declaration'}`
          }
        >
          ← back
        </button>
        <input
          className="search"
          value={query}
          placeholder="Search declarations…"
          onChange={(e) => setQuery(e.target.value)}
        />
        {hidden.names.length > 0 && (
          <button
            className={`chip mode ${hidden.active ? 'on' : ''}`}
            onClick={() => updateHidden({ ...hidden, active: !hidden.active })}
            title={`${hidden.names.length} declaration(s) hidden. Click to show them again.`}
          >
            hide hidden ({hidden.names.length})
          </button>
        )}
        <button
          className={`chip mode ${upToTrusted ? 'on' : ''}`}
          onClick={() => setUpToTrusted(!upToTrusted)}
          title="Stop tracing dependencies at declarations you have marked trusted, and show characterized definitions as their characterising theorems."
        >
          up to trusted
        </button>
        {hasServer() && (
          <button
            className={`chip mode ${showFollows ? 'on' : ''}`}
            onClick={() => setShowFollows(!showFollows)}
            title="Whose certificates count as your own trust marks"
          >
            people you trust
            {following.size + followingKeys.length > 0
              ? ` (${following.size + followingKeys.length})`
              : ''}
          </button>
        )}
        {hasServer() && <ServerPicker />}
        <div className="repos">
          <span className="label">Repositories</span>
          {source.repos().map((repo) => (
            <button
              key={repo}
              className={`chip ${repoFilter.size === 0 || repoFilter.has(repo) ? 'on' : ''}`}
              onClick={() => toggleRepo(repo)}
            >
              {repo}
            </button>
          ))}
          {repoFilter.size > 0 && (
            <button className="chip clear" onClick={() => setRepoFilter(new Set())}>
              clear
            </button>
          )}
        </div>
      </div>

      {hasServer() && showFollows && (
        <FollowPanel
          identity={identity}
          following={following}
          followingKeys={followingKeys}
          federatedCount={federated.size}
          onChange={() => void refreshFederation()}
        />
      )}

      <div className="layout">
        <aside className="results">
          {results.map((decl) => (
            <button
              key={decl.id}
              className={`result ${decl.id === root ? 'active' : ''}`}
              onClick={() => focus(decl.id)}
            >
              <KindBadge decl={decl} />
              <span className="result-name">{decl.name}</span>
              <span className="result-module">{decl.module}</span>
            </button>
          ))}
          {results.length === 0 && <p className="empty">No matching declarations.</p>}
        </aside>

        <main>
          {rootDecl && root !== null ? (
            <>
              <section className="decl-header">
                <div className="decl-title">
                  <KindBadge decl={rootDecl} />
                  <h2>{rootDecl.name}</h2>
                </div>
                <div className="decl-module">{rootDecl.module}</div>
                <div className="decl-flags">
                  <span className={rootDecl.isData ? 'flag data' : 'flag prop'}>
                    {rootDecl.isData ? 'data-carrying' : 'proof'}
                  </span>
                  {rootDecl.usesSorry && <span className="flag sorry">uses sorry</span>}
                  {rootDecl.axioms && rootDecl.axioms.length > 0 && (
                    <span className="flag axioms">axioms: {rootDecl.axioms.join(', ')}</span>
                  )}
                </div>
              </section>

              {code && (
                <section className="code-pane">
                  {/* The docstring says what the declaration is for, which
                      nothing derived from the term can tell you. */}
                  {code.doc && <p className="docstring">{code.doc}</p>}
                  <CodeView block={code.signature} onSelectName={focusName} isKnown={isKnown} />
                  {code.value ? (
                    <>
                      {/* An inductive's body is its constructor list, which Lean
                          introduces with `where`, not with `:=`. */}
                      <div className="code-sep">
                        {rootDecl.kind === 'inductive' ? 'where' : ':='}
                      </div>
                      <CodeView block={code.value} onSelectName={focusName} isKnown={isKnown} />
                    </>
                  ) : (
                    rootDecl.isProp && <div className="code-note">proof omitted</div>
                  )}
                </section>
              )}

              <MarksPanel
                decl={rootDecl}
                marks={marks}
                onSelectName={focusName}
                isKnown={isKnown}
                search={searchDecls}
                onEdit={marks.editable ? editMarks : undefined}
              />

              <WhoTrusts
                decl={rootDecl}
                meta={meta}
                hasher={meta.hasher ?? 'semantic-v1'}
                identity={identity}
                following={following}
                followingKeys={new Set(followingKeys.map((key) => key.fingerprint))}
                onFollowingChange={() => void refreshFederation()}
              />

              <section className="direction">
                <button
                  className={direction === 'dependencies' ? 'on' : ''}
                  onClick={() => setDirection('dependencies')}
                >
                  ↓ dependencies
                </button>
                <button className={direction === 'dependents' ? 'on' : ''} onClick={() => setDirection('dependents')}>
                  ↑ dependents
                </button>
                <label>
                  depth
                  <input
                    type="range"
                    min={1}
                    max={maxDepth}
                    value={depth}
                    onChange={(e) => setDepth(Number(e.target.value))}
                  />
                  {depth}
                </label>
              </section>

              <div className="panes">
                <section className="pane tree-pane">
                  <h3>{direction === 'dependencies' ? 'Definitional dependencies' : 'Dependents'}</h3>
                  <DepsTree
                    key={`${root}-${direction}-${upToTrusted}`}
                    source={treeSource ?? source}
                    id={root}
                    direction={direction}
                    onSelect={focus}
                    selected={selected}
                    revealPath={revealPath}
                    isTrusted={isTrusted}
                    isCharacterized={upToTrusted ? isCharacterized : undefined}
                  />
                </section>

                <section className="pane graph-pane">
                  <div className="pane-head">
                    <h3>Graph</h3>
                    <button className="expand" onClick={() => setExpanded(true)}>
                      expand ⤢
                    </button>
                  </div>
                  <GraphView
                    source={viewSource ?? source}
                    root={root}
                    direction={direction}
                    depth={depth}
                    selected={selected ?? root}
                    onSelect={pick}
                    onFocus={focus}
                    dimUnconnected={picked}
                    isTrusted={isTrusted}
                    accept={accept ?? undefined}
                    isHidden={isHidden}
                    onHide={hide}
                    onUnhide={unhide}
                    preview={preview}
                  />
                </section>
              </div>

            </>
          ) : (
            <p className="empty">Select a declaration to begin.</p>
          )}
        </main>
      </div>
    </div>
  )
}
