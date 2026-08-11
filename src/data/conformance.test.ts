import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as openpgp from 'openpgp'
import { canonicalClaim, type Claim } from './certificates'

/**
 * The vectors `chrisflav/trust` publishes, checked here.
 *
 * The canonical bytes used to exist three times — in Lean, in the TypeScript
 * server, and here — pinned to each other by a golden claim copied between test
 * files.  The server and the CLI are Lean now, so there are two, and this one is
 * the one that has to be independent: it is where a reader checks a signature
 * they were handed, in their own browser, against a key that travelled with it.
 *
 * `conformance/` is the whole of the contract between the two.  It is fetched
 * into the working tree by CI (`.github/workflows/ci.yml`) rather than vendored,
 * because a vendored copy is a copy that drifts; when it is absent — a plain
 * local checkout — these tests skip, the way the index tests do.
 */

const DIR = resolve(__dirname, '../../conformance')
const has = existsSync(resolve(DIR, 'claims.json'))
const describeIf = has ? describe : describe.skip

function load<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(DIR, name), 'utf8')) as T
}

interface ClaimVector {
  name: string
  claim: Claim
  canonical: string
}

interface EntryVector {
  name: string
  entry: {
    claim: Claim
    signature: string
    key: string
    fingerprint: string
  }
  canonical: string
  expect: { accept: boolean; rule?: string }
}

describeIf('the canonical bytes agree with Lean', () => {
  it('reproduces every claim vector byte for byte', () => {
    const vectors = load<ClaimVector[]>('claims.json')
    expect(vectors.length).toBeGreaterThan(0)
    for (const vector of vectors) {
      expect(canonicalClaim(vector.claim), vector.name).toBe(vector.canonical)
    }
  })

  it('covers the cases where implementations diverge', () => {
    // Not a tautology: it asserts the file still exercises what it was written
    // to exercise, so that thinning it out fails here rather than silently.
    const names = load<ClaimVector[]>('claims.json').map((v) => v.name)
    expect(names).toContain('awkward-characters')
    expect(names).toContain('note-forging-a-field')
    expect(names).toContain('c0-controls')
  })

  it('does not let a note forge a field', () => {
    const vectors = load<ClaimVector[]>('claims.json')
    const hostile = vectors.find((v) => v.name === 'note-forging-a-field')!
    const reparsed = JSON.parse(canonicalClaim(hostile.claim)) as Record<string, string>
    // The note tries to close its string and set `hash`.  If the escaping is
    // right, `hash` is still the claim's own.
    expect(reparsed.hash).toBe(hostile.claim.hash)
  })
})

describeIf('signatures verify here, over the bytes Lean signed', () => {
  it('accepts the entry the vectors say to accept', async () => {
    const vectors = load<EntryVector[]>('entries.json')
    const good = vectors.find((v) => v.name === 'well-formed')!
    const key = await openpgp.readKey({ armoredKey: good.entry.key })
    const result = await openpgp.verify({
      message: await openpgp.createMessage({ text: canonicalClaim(good.entry.claim) }),
      signature: await openpgp.readSignature({ armoredSignature: good.entry.signature }),
      verificationKeys: key,
    })
    await expect(result.signatures[0].verified).resolves.toBe(true)
  })

  it('agrees that the canonical bytes in the file are the ones it would produce', () => {
    for (const vector of load<EntryVector[]>('entries.json')) {
      // Only for entries whose claim is the unmodified one; the tampered
      // vectors deliberately carry a signature over other bytes.
      if (vector.name === 'signature-over-other-bytes') continue
      if (vector.expect.accept || vector.name.startsWith('fingerprint')) {
        expect(canonicalClaim(vector.entry.claim), vector.name).toBe(vector.canonical)
      }
    }
  })

  it('refuses a signature over other bytes', async () => {
    const vectors = load<EntryVector[]>('entries.json')
    const tampered = vectors.find((v) => v.name === 'signature-over-other-bytes')!
    const key = await openpgp.readKey({ armoredKey: tampered.entry.key })
    const result = await openpgp.verify({
      message: await openpgp.createMessage({ text: canonicalClaim(tampered.entry.claim) }),
      signature: await openpgp.readSignature({ armoredSignature: tampered.entry.signature }),
      verificationKeys: key,
    })
    await expect(result.signatures[0].verified).rejects.toThrow()
  })

  it('sees that the subkey vector names a fingerprint that is not the primary', async () => {
    // §3.4 rule 3.  The browser does not enforce acceptance — a node does — but
    // it displays the fingerprint an entry claims, so it has to be able to tell
    // that this one is not the key's own.
    const vectors = load<EntryVector[]>('entries.json')
    const subkey = vectors.find((v) => v.name === 'fingerprint-is-the-subkey')!
    const key = await openpgp.readKey({ armoredKey: subkey.entry.key })
    expect(key.getFingerprint().toLowerCase()).not.toBe(subkey.entry.fingerprint.toLowerCase())
    const subkeys = key.getSubkeys().map((s) => s.getFingerprint().toLowerCase())
    expect(subkeys).toContain(subkey.entry.fingerprint.toLowerCase())
  })
})
