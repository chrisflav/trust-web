/**
 * Where the reader is, as the browser's history has it.
 *
 * The application used to keep its own stack of previous declarations and
 * rewrite the address bar with `replaceState`, which meant the "← back" button
 * and the browser's back button did entirely different things: one walked back
 * through the declarations you had opened, the other left the page, because as
 * far as the browser was concerned you had never gone anywhere.
 *
 * So the history *is* the stack now.  Opening a declaration pushes an entry,
 * going back pops one, and both buttons are the same button — including after a
 * reload, where a remembered stack of our own would have been lost but the
 * browser's is not.
 *
 * What counts as somewhere you were is the declaration and whether the graph is
 * full screen: the two things a Back button visibly undoes.  The depth, the
 * direction and the filters are settings rather than positions — they are still
 * carried in the link, so a shared one arrives as it was read, but changing one
 * amends the entry you are on rather than making a new one.  A reader who has
 * moved a slider four times and presses back expects the declaration they came
 * from, not the slider where it was.
 */

/** A position: the declaration being read, and whether the graph fills the screen. */
export interface NavEntry {
  decl: string
  expanded: boolean
}

/**
 * An entry as it is stored, with what the back button needs to describe itself.
 *
 * `seq` counts the entries this application pushed, so `0` is the one it
 * started at and the button can be disabled there rather than offering to leave
 * the site.  `prev` is the declaration one step back, so the button can say
 * where it goes — both read off the entry itself, because a stack kept beside
 * the history would be the thing that disagrees with it.
 */
export interface NavState extends NavEntry {
  seq: number
  prev: string | null
}

/**
 * Read our own state out of a history entry, or null if it is not ours.
 *
 * Everything here is defensive: a history entry can be written by anything that
 * shares the origin, can be older than the current shape of this type, and
 * survives a reload, so it is treated as input rather than as something we
 * wrote.  The cost of not recognising one is a back button that does nothing;
 * the cost of trusting one blindly is a crash on navigation.
 */
export function readNav(state: unknown): NavState | null {
  if (typeof state !== 'object' || state === null) return null
  const held = (state as { trust?: unknown }).trust
  if (typeof held !== 'object' || held === null) return null
  const { decl, expanded, seq, prev } = held as Record<string, unknown>
  if (typeof decl !== 'string' || decl.length === 0) return null
  if (typeof seq !== 'number' || !Number.isFinite(seq) || seq < 0) return null
  return {
    decl,
    expanded: expanded === true,
    seq: Math.floor(seq),
    prev: typeof prev === 'string' ? prev : null,
  }
}

/** Whether the reader is still in the same place, so no entry is owed. */
export function sameEntry(state: NavState | null, entry: NavEntry): boolean {
  return state !== null && state.decl === entry.decl && state.expanded === entry.expanded
}

/** The entry to push for `entry`, given the one being left. */
export function nextNav(current: NavState | null, entry: NavEntry): NavState {
  return {
    ...entry,
    seq: current === null ? 0 : current.seq + 1,
    prev: current === null ? null : current.decl,
  }
}

/** What goes into `history.pushState`, namespaced so nothing else's state is mistaken for ours. */
export function navState(state: NavState): { trust: NavState } {
  return { trust: state }
}

/**
 * Whether closing the expanded graph is a step back rather than a new position.
 *
 * It is exactly when the entry behind this one is the same declaration: entries
 * are only pushed when something changed, so a previous entry naming the same
 * declaration can only be the unexpanded view of it — the place the reader
 * opened the graph from.  Then closing the graph and pressing back are the same
 * action and must not leave two entries where the reader took one step.
 */
export function closeIsBack(state: NavState | null): boolean {
  return state !== null && state.expanded && state.prev === state.decl
}
