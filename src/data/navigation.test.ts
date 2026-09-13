import { describe, expect, it } from 'vitest'
import { closeIsBack, nextNav, navState, readNav, sameEntry, type NavState } from './navigation'

const AT: NavState = { decl: 'Nat.gcd', expanded: false, seq: 3, prev: 'Nat.mod' }

describe('readNav', () => {
  it('reads back what was written', () => {
    expect(readNav(navState(AT))).toEqual(AT)
  })

  // A history entry outlives the code that wrote it — a reload lands on one
  // written by whatever was deployed before — so anything unrecognisable has to
  // read as "not ours" rather than as a position to restore.
  it('refuses anything that is not ours', () => {
    expect(readNav(null)).toBeNull()
    expect(readNav('a string')).toBeNull()
    expect(readNav({})).toBeNull()
    expect(readNav({ trust: null })).toBeNull()
    expect(readNav({ trust: { seq: 0 } })).toBeNull()
    expect(readNav({ trust: { decl: '', seq: 0 } })).toBeNull()
    expect(readNav({ trust: { decl: 'Nat.gcd' } })).toBeNull()
    expect(readNav({ trust: { decl: 'Nat.gcd', seq: -1 } })).toBeNull()
    expect(readNav({ trust: { decl: 'Nat.gcd', seq: Number.NaN } })).toBeNull()
  })

  it('fills in what an older entry did not carry', () => {
    expect(readNav({ trust: { decl: 'Nat.gcd', seq: 0 } })).toEqual({
      decl: 'Nat.gcd',
      expanded: false,
      seq: 0,
      prev: null,
    })
  })
})

describe('nextNav', () => {
  it('starts at zero, so the first position is not one to go back from', () => {
    expect(nextNav(null, { decl: 'Nat.gcd', expanded: false })).toEqual({
      decl: 'Nat.gcd',
      expanded: false,
      seq: 0,
      prev: null,
    })
  })

  it('counts on, and records where it came from', () => {
    expect(nextNav(AT, { decl: 'Nat.succ', expanded: false })).toEqual({
      decl: 'Nat.succ',
      expanded: false,
      seq: 4,
      prev: 'Nat.gcd',
    })
  })

  it('treats opening the graph as a position of its own', () => {
    expect(nextNav(AT, { decl: 'Nat.gcd', expanded: true })).toEqual({
      decl: 'Nat.gcd',
      expanded: true,
      seq: 4,
      prev: 'Nat.gcd',
    })
  })
})

describe('sameEntry', () => {
  it('is the declaration and the graph, and nothing else', () => {
    expect(sameEntry(AT, { decl: 'Nat.gcd', expanded: false })).toBe(true)
    expect(sameEntry(AT, { decl: 'Nat.gcd', expanded: true })).toBe(false)
    expect(sameEntry(AT, { decl: 'Nat.mod', expanded: false })).toBe(false)
    expect(sameEntry(null, { decl: 'Nat.gcd', expanded: false })).toBe(false)
  })
})

describe('closeIsBack', () => {
  it('goes back when the graph was opened from the declaration behind it', () => {
    expect(closeIsBack({ decl: 'Nat.gcd', expanded: true, seq: 1, prev: 'Nat.gcd' })).toBe(true)
  })

  // Arriving on `?graph=expanded`, or focusing another declaration from inside
  // the graph: there is no unexpanded view of *this* declaration behind us, so
  // closing is somewhere new rather than a step back.
  it('does not, when there is nothing of the kind behind it', () => {
    expect(closeIsBack({ decl: 'Nat.gcd', expanded: true, seq: 0, prev: null })).toBe(false)
    expect(closeIsBack({ decl: 'Nat.gcd', expanded: true, seq: 2, prev: 'Nat.mod' })).toBe(false)
    expect(closeIsBack({ decl: 'Nat.gcd', expanded: false, seq: 2, prev: 'Nat.gcd' })).toBe(false)
    expect(closeIsBack(null)).toBe(false)
  })
})
