import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { voucherOf, type Vouch } from '../data/certificates'
import type { GraphSource } from '../data/source'
import type { DeclCode, NodeId, TrustMark } from '../data/types'

/** Why a declaration counts as trusted, from both places a judgement can come from. */
export interface TrustedBy {
  /** The mark recorded in this index's marks file, when there is one. */
  mark?: TrustMark
  /** The certificates you count — your own among them. */
  vouches: Vouch[]
}

/**
 * What the card may say and do about trust.
 *
 * The graph draws a trusted declaration on a green field, which says *that* it
 * is trusted and nothing about by whom — and in the expanded view, which is
 * where a large closure is actually read, there was nowhere else to find out.
 * So the card names them, from the set the page already holds; no request is
 * made to fill it in, or hovering a wide layer would ask a federated question
 * per node.
 *
 * The two verbs are the two kinds of judgement this application records, and
 * they are not interchangeable: a **mark** goes in the version-controlled marks
 * file, so it needs the dev server that can write one, and a **certificate** is
 * published to a node under your account, so it needs a hash to key it by and
 * somebody signed in.  Whichever is available is offered; usually that is one
 * of them, and the buttons say which.
 */
export interface PreviewTrust {
  trustedBy: (id: NodeId) => TrustedBy
  /** Record or withdraw a mark; absent when the marks file is read-only. */
  onMark?: (name: string, trusted: boolean) => Promise<void>
  /** Publish or withdraw a certificate; absent when nobody is signed in. */
  onVouch?: (id: NodeId, vouch: boolean) => Promise<void>
}

interface NodePreviewProps {
  source: GraphSource
  id: NodeId
  /** Where the pointer was, in client coordinates. */
  x: number
  y: number
  hidden: boolean
  onHide: (name: string) => void
  onUnhide: (name: string) => void
  /** Keep the card open while the pointer is on it, so its buttons are usable. */
  onPointerEnter: () => void
  onPointerLeave: () => void
  /**
   * Whether to render the body as well as the signature.
   *
   * Held by the graph rather than here so that it survives moving from one node
   * to the next: a reader who wants to see definitions wants to see them for
   * every node they look at, not to click the toggle again on each.
   */
  showValue: boolean
  onShowValue: (show: boolean) => void
  /** Who trusts this, and how to join them.  Absent leaves a plain preview. */
  trust?: PreviewTrust
}

const WIDTH = 460

/** One name to show under "trusted by", and everything behind it. */
interface Voucher {
  text: string
  verified: boolean
  why: string
}

/**
 * Who to name, with the reasons folded together.
 *
 * A mark and a certificate of your own are two judgements and one person, so
 * they are shown as one name with both reasons behind it; a list that said
 * "you · you" would be reporting on our storage rather than on who vouched.
 */
function vouchersFor(trusted: TrustedBy | undefined): Voucher[] {
  if (!trusted) return []
  const found: Voucher[] = []
  if (trusted.mark) {
    found.push({
      text: 'you',
      verified: true,
      why:
        'Marked trusted in this index’s marks file' +
        (trusted.mark.commit ? `, at ${trusted.mark.commit}` : '') +
        (trusted.mark.note ? `: ${trusted.mark.note}` : '.'),
    })
  }
  for (const vouch of trusted.vouches) {
    const who = voucherOf(vouch)
    const already = found.find((entry) => entry.text === who.text)
    if (already) {
      if (!already.why.includes(who.why)) already.why = `${already.why}\n${who.why}`
      already.verified = already.verified && who.verified
      continue
    }
    found.push({ ...who })
  }
  return found
}

/**
 * What a declaration says, shown where the pointer is.
 *
 * A node in the graph is a hundred and fifty pixels of elided name, which is
 * enough to find something and not nearly enough to judge it.  The docstring
 * and signature are what actually answer "is this what I think it is", and both
 * are already in the index — the code shard is fetched on demand, so hovering
 * one node costs one shard the reader was likely to need anyway.  The body is
 * in the same shard, so showing it too costs nothing beyond the room it takes.
 */
export function NodePreview({
  source,
  id,
  x,
  y,
  hidden,
  onHide,
  onUnhide,
  onPointerEnter,
  onPointerLeave,
  showValue,
  onShowValue,
  trust,
}: NodePreviewProps) {
  const [code, setCode] = useState<DeclCode | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const decl = source.node(id)

  useEffect(() => {
    let current = true
    setCode(null)
    setError(null)
    source.code(id).then((loaded) => {
      if (current) setCode(loaded)
    })
    return () => {
      current = false
    }
  }, [source, id])

  if (!decl) return null

  // Kept inside the viewport: a node near the right edge would otherwise put
  // its preview off screen, which is exactly where the long names are.
  const left = Math.min(x + 16, window.innerWidth - WIDTH - 16)
  const flipAbove = y > window.innerHeight - 260
  // The card grows with what it is asked to show — a docstring, a definition,
  // a list of people — so it is given the room that is actually there and
  // scrolls inside it, rather than running off the bottom of the screen.
  const room = flipAbove ? y - 26 : window.innerHeight - y - 34
  const style: CSSProperties = {
    left: Math.max(8, left),
    top: flipAbove ? undefined : y + 18,
    bottom: flipAbove ? window.innerHeight - y + 18 : undefined,
    width: WIDTH,
    maxHeight: Math.max(180, room),
  }

  const trusted = trust?.trustedBy(id)
  const vouchers = vouchersFor(trusted)
  const marked = trusted?.mark !== undefined
  const mine = (trusted?.vouches ?? []).some((vouch) => vouch.mine)
  const hash = source.hashOf(id)

  /** Run one judgement, keeping the card up and saying so if it fails. */
  const act = async (change: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await change()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Rendered into `document.body` rather than in place.  The expanded view
  // scales its canvas with a CSS transform, and a transformed ancestor becomes
  // the containing block for `position: fixed` — so in place, the preview was
  // positioned relative to the zoomed canvas and scaled along with it, landing
  // nowhere near the cursor.
  return createPortal(
    <div
      className="node-preview"
      style={style}
      role="tooltip"
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
    >
      <div className="node-preview-name">{decl.name}</div>
      <div className="node-preview-module">{decl.module}</div>
      {code?.doc && <p className="node-preview-doc">{code.doc}</p>}
      {code ? (
        <pre className="node-preview-code">
          <code>{code.signature.text}</code>
        </pre>
      ) : (
        <p className="node-preview-doc">Loading…</p>
      )}
      {showValue && code?.value && (
        <>
          {/* An inductive's body is its constructor list, which Lean introduces
              with `where`, not with `:=`. */}
          <div className="node-preview-sep">{decl.kind === 'inductive' ? 'where' : ':='}</div>
          <pre className="node-preview-code value">
            <code>{code.value.text}</code>
          </pre>
        </>
      )}

      {trust && (
        <div className="node-preview-trust">
          {vouchers.length > 0 ? (
            <>
              <span className="node-preview-trust-label">trusted by</span>
              {vouchers.map((voucher) => (
                <span
                  key={voucher.text}
                  className={`node-preview-voucher${voucher.verified ? '' : ' unverified'}`}
                  title={voucher.why}
                >
                  {voucher.text}
                </span>
              ))}
            </>
          ) : (
            <span className="node-preview-trust-label none">nobody vouches for this yet</span>
          )}
        </div>
      )}

      <div className="node-preview-actions">
        <span className="node-preview-hint">double-click to focus</span>
        <div className="node-preview-buttons">
          {code?.value && (
            <button
              className={showValue ? 'on' : ''}
              title={
                showValue
                  ? 'Show signatures only'
                  : 'Show the body as well as the signature, here and on the next node'
              }
              onClick={(event) => {
                event.stopPropagation()
                onShowValue(!showValue)
              }}
            >
              {showValue ? 'signature' : 'definition'}
            </button>
          )}
          {trust?.onMark && (
            <button
              disabled={busy}
              title={
                marked
                  ? 'Remove this declaration from the marks file'
                  : 'Record this declaration as trusted in the marks file, where it is version-controlled with the library'
              }
              onClick={(event) => {
                event.stopPropagation()
                void act(() => trust.onMark!(decl.name, !marked))
              }}
            >
              {marked ? 'untrust' : 'mark trusted'}
            </button>
          )}
          {trust?.onVouch && hash.length > 0 && (
            <button
              disabled={busy}
              title={
                mine
                  ? 'Withdraw your certificate for this content'
                  : 'Publish an unsigned certificate for this content, with no note. Open the declaration to add either.'
              }
              onClick={(event) => {
                event.stopPropagation()
                void act(() => trust.onVouch!(id, !mine))
              }}
            >
              {mine ? 'withdraw' : 'trust this'}
            </button>
          )}
          <button
            onClick={(event) => {
              event.stopPropagation()
              if (hidden) onUnhide(decl.name)
              else onHide(decl.name)
            }}
          >
            {hidden ? 'unhide' : 'hide'}
          </button>
        </div>
      </div>
      {error && <p className="node-preview-error">{error}</p>}
    </div>,
    document.body,
  )
}
