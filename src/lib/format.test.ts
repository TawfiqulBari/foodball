import { describe, it, expect } from 'vitest'
import { isLocked, countdownToLock, kickoffLabel, awaitingResult } from './format'

const NOW = new Date('2026-06-11T12:00:00Z')

describe('isLocked', () => {
  it('is locked once kickoff has passed', () => {
    expect(isLocked('2026-06-11T11:59:59Z', NOW)).toBe(true)
    expect(isLocked('2026-06-11T12:00:00Z', NOW)).toBe(true)
  })
  it('is open before kickoff', () => {
    expect(isLocked('2026-06-11T12:00:01Z', NOW)).toBe(false)
  })
})

describe('countdownToLock', () => {
  it('formats days+hours, hours+mins, mins, and locked', () => {
    expect(countdownToLock('2026-06-13T16:00:00Z', NOW)).toBe('2d 4h')
    expect(countdownToLock('2026-06-11T15:12:00Z', NOW)).toBe('3h 12m')
    expect(countdownToLock('2026-06-11T12:08:00Z', NOW)).toBe('8m')
    expect(countdownToLock('2026-06-11T10:00:00Z', NOW)).toBe('Locked')
  })
})

describe('kickoffLabel', () => {
  it('produces a non-empty local label', () => {
    expect(kickoffLabel('2026-06-11T16:00:00Z').length).toBeGreaterThan(0)
  })
})

describe('awaitingResult', () => {
  const KO = '2026-06-11T12:00:00Z'
  it('is false while the match is plausibly still in play (< 150 min)', () => {
    expect(awaitingResult(KO, new Date('2026-06-11T13:00:00Z'))).toBe(false) // 60'
    expect(awaitingResult(KO, new Date('2026-06-11T14:00:00Z'))).toBe(false) // 120'
  })
  it('is true once well past full-time (> 150 min) and still unsettled', () => {
    expect(awaitingResult(KO, new Date('2026-06-11T14:31:00Z'))).toBe(true) // 151'
    expect(awaitingResult(KO, new Date('2026-06-11T18:00:00Z'))).toBe(true) // hours later
  })
})
