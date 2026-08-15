import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_BRANCH,
  describeLocation,
  forgetLocation,
  parseGitHubLocation,
  paramsForLocation,
  recentLocations,
  repositoryUrl,
  sameLocation,
  type IndexLocation,
} from '../data/indexLocation'

/**
 * Go to an index.
 *
 * A navigation rather than a state change.  An index is tens of megabytes held
 * in a worker, and everything on the page — the graph, the marks, the filters,
 * the history — is *about* the index; carrying any of it across a change would
 * be showing one library's answers under another library's name.  The address
 * bar is also where the choice belongs, so that the link can be shared.
 */
function go(location: IndexLocation): void {
  window.location.assign(`?${new URLSearchParams(paramsForLocation(location))}`)
}

/**
 * What was typed, as a location.
 *
 * A slash or a dot means a repository; anything else names a directory under
 * the deployment's own `/index/`, which is how a self-hosted index is selected
 * and still the fastest thing to type for one that is deployed.
 */
function parse(text: string): IndexLocation | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.includes('/') || trimmed.includes('.')) return parseGitHubLocation(trimmed)
  return { kind: 'local', name: trimmed }
}

interface IndexDialogProps {
  current: IndexLocation | null
  /** Absent when there is nothing to go back to, i.e. nothing has been picked yet. */
  onClose?: () => void
}

/**
 * Which library to read.
 *
 * A text field rather than a menu, because nothing can produce the menu: an
 * index published to a branch is only findable if you know the repository, and
 * neither `raw.githubusercontent.com` nor the deployment's own `/index/` will
 * list what it holds.  So the reader says what they want, and what this browser
 * has read before is offered back.
 */
export function IndexDialog({ current, onClose }: IndexDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const [value, setValue] = useState('')
  const [recent, setRecent] = useState<IndexLocation[]>(recentLocations)

  // `showModal` rather than the `open` attribute: it is what gives the backdrop,
  // the focus trap and the top layer, none of which are worth reimplementing.
  useEffect(() => {
    const dialog = ref.current
    if (!dialog || dialog.open) return
    dialog.showModal()
  }, [])

  const parsed = parse(value)

  const drop = (location: IndexLocation) => {
    forgetLocation(location)
    setRecent(recentLocations())
  }

  return (
    <dialog
      ref={ref}
      className="index-dialog"
      // Escape fires `cancel`; with nothing picked there is nothing to escape
      // to, and a dialog that closes onto a blank page is worse than one that
      // stays.
      onCancel={(event) => {
        if (!onClose) event.preventDefault()
        else onClose()
      }}
      onClose={() => onClose?.()}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          // The default would close the dialog; navigating is what should
          // happen, and it only should when what was typed is a repository.
          event.preventDefault()
          if (parsed) go(parsed)
        }}
      >
        <h2>{current ? 'Read a different library' : 'Which library?'}</h2>
        <p className="index-lede">
          trust shows what a Lean declaration rests on. Name a repository that publishes an index,
          or one this deployment serves itself.
        </p>

        <div className="index-entry">
          <input
            className="index-input"
            value={value}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            aria-label="Repository or index name"
            placeholder="owner/repo, or a github.com URL"
            onChange={(event) => setValue(event.target.value)}
          />
          <button type="submit" disabled={!parsed}>
            read
          </button>
        </div>

        {recent.length > 0 && (
          <>
            <h3>Read before</h3>
            <ul className="index-recent">
              {recent.map((location) => (
                <li key={`${location.kind}:${indexKey(location)}`}>
                  <button
                    type="button"
                    className={current && sameLocation(location, current) ? 'current' : undefined}
                    onClick={() => go(location)}
                  >
                    {describeLocation(location)}
                  </button>
                  <button
                    type="button"
                    className="index-forget"
                    title="Forget this one"
                    aria-label={`Forget ${describeLocation(location)}`}
                    onClick={() => drop(location)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="index-hint">
          A repository is readable here once its CI publishes an index to the{' '}
          <code>{DEFAULT_BRANCH}</code> branch — see{' '}
          <a href="https://github.com/chrisflav/trust-action" target="_blank" rel="noreferrer">
            chrisflav/trust-action
          </a>
          .
        </p>

        {onClose && (
          <button type="button" className="index-cancel" onClick={onClose}>
            cancel
          </button>
        )}
      </form>
    </dialog>
  )
}

/** Stable enough to key a list by; two indexes differ iff their URLs do. */
function indexKey(location: IndexLocation): string {
  return location.kind === 'local'
    ? location.name
    : `${location.owner}/${location.repo}/${location.branch}/${location.name}`
}

/**
 * Which library this page is reading, and the way to a different one.
 *
 * Sits in the header rather than among the controls because it is the one
 * choice the whole page is downstream of.
 */
export function IndexPicker({ current }: { current: IndexLocation }) {
  const [open, setOpen] = useState(false)
  const repo = repositoryUrl(current)

  return (
    <>
      <button
        className="index-picker"
        onClick={() => setOpen(true)}
        title={
          repo
            ? `Reading the index published by ${repo}. Click to read another library.`
            : 'Reading an index served by this deployment. Click to read another library.'
        }
      >
        <span className="index-name">{describeLocation(current)}</span>
        {current.kind === 'github' && <span className="index-origin">github</span>}
      </button>
      {open && <IndexDialog current={current} onClose={() => setOpen(false)} />}
    </>
  )
}
