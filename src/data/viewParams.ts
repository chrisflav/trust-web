/**
 * The part of the view that lives in the address bar.
 *
 * A link to a declaration is worth little if it does not also carry how the
 * graph was being read: the same declaration at depth 2 with Mathlib hidden and
 * at depth 9 with everything shown are different pictures, and the one worth
 * sending is the one on screen.  So the filters and the budgets go in the URL
 * beside `decl` and `depth`.
 *
 * Only what differs from the defaults is written, so the ordinary link stays
 * short enough to paste into a message.  Reading is forgiving and writing is
 * strict: a URL is typed and edited by people, so anything unparseable falls
 * back to the default rather than failing the load.
 */
import type { GraphOptions } from '../components/GraphView'

/**
 * Which repositories to draw.
 *
 * An empty set means all of them, which is also what an absent `repos=` means,
 * so the common link carries no parameter.  Names not in the index are kept
 * rather than dropped: the filter is applied by membership, so a stale name
 * costs nothing, and discarding it silently would make a link that half-works
 * look like one that works.
 */
export function reposFromParams(params: URLSearchParams): Set<string> {
  return new Set(
    (params.get('repos') ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  )
}

/** A budget of `-1`, `0` or `abc` is not one; fall back rather than draw nothing. */
function positiveOr(raw: string | null, fallback: number): number {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/**
 * The node and edge budgets.
 *
 * These decide what the expanded graph draws — past them it truncates — so two
 * readers following one link with different budgets see different pictures.
 * That is worth carrying, where the purely cosmetic settings beside them
 * (`nodeWidth`, `layerGap`) are not: those change how it looks, not what it
 * says.
 */
export function graphOptionsFromParams(
  params: URLSearchParams,
  defaults: GraphOptions,
): GraphOptions {
  return {
    ...defaults,
    maxNodes: positiveOr(params.get('nodes'), defaults.maxNodes),
    maxEdges: positiveOr(params.get('edges'), defaults.maxEdges),
  }
}

/** What the view currently is, as the parameters that would bring it back. */
export interface ViewState {
  decl: string
  direction: 'dependencies' | 'dependents'
  depth: number
  expanded: boolean
  repos: Set<string>
  options: GraphOptions
}

/**
 * The address bar for a view, given where the index is.
 *
 * `base` is the index's own parameters — `?gh=`, `?release=` or `?repo=` — which
 * come first so that a link names the library before the declaration in it.
 */
export function paramsForView(
  base: Record<string, string>,
  view: ViewState,
  defaults: GraphOptions,
): URLSearchParams {
  const params = new URLSearchParams({
    ...base,
    decl: view.decl,
    dir: view.direction,
    depth: String(view.depth),
  })
  if (view.expanded) params.set('graph', 'expanded')
  // A filter of nothing and a filter of everything draw the same graph, so
  // neither is worth a parameter.  Sorted, so that the same view produces the
  // same link however the chips were clicked.
  if (view.repos.size > 0) params.set('repos', [...view.repos].sort().join(','))
  if (view.options.maxNodes !== defaults.maxNodes) {
    params.set('nodes', String(view.options.maxNodes))
  }
  if (view.options.maxEdges !== defaults.maxEdges) {
    params.set('edges', String(view.options.maxEdges))
  }
  return params
}
