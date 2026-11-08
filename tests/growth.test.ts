import { expect, test } from 'claude-code/testing'

import type { WeatherReading, WeatherSample } from '../types'
import { endTurn, forecast, growthRate, heroText, markCompaction, median, TURNS_CAP } from '../hooks/forecast'

const reading = (threshold = 160_000): WeatherReading => ({
  window: 200_000,
  threshold,
  limits: [],
  usd: null,
  startedAt: 0,
  measuredAt: 0,
  categories: [],
})

const ends = (...tokens: number[]): WeatherSample[] =>
  tokens.map((t, i) => ({ at: i, tokens: t, output: 0, isCompaction: false, isTurnEnd: true }))

test('median of odd and even lists', async () => {
  expect(median([3, 1, 2])).toBe(2)
  expect(median([4, 1, 3, 2])).toBe(2.5)
})

test('growth is the median of the last ≤8 deltas', async () => {
  // Deltas: 1k..12k, the last eight are 5k..12k, median 8.5k.
  let t = 10_000
  const list = [t]
  for (let d = 1; d <= 12; d += 1) list.push((t += d * 1000))
  const g = growthRate(ends(...list))
  expect(g.basis).toBe(8)
  expect(g.rate).toBe(8_500)
})

test('one spike barely moves growth', async () => {
  // Steady +2k turns with one +60k read: the median stays 2k (a mean would be ~10k).
  const g = growthRate(ends(10_000, 12_000, 14_000, 74_000, 76_000, 78_000, 80_000, 82_000))
  expect(g.rate).toBe(2_000)
  const f = forecast(ends(10_000, 12_000, 14_000, 74_000, 76_000, 78_000, 80_000, 82_000), reading())!
  expect(f.turnsLeft).toBe(39)
  expect(heroText(f)).toBe('~39 turns left')
})

test('negative deltas are left out', async () => {
  // A shrink (cleared tool output) between growth: only the rises count.
  const g = growthRate(ends(40_000, 45_000, 41_000, 46_000, 51_000))
  expect(g.basis).toBe(3)
  expect(g.rate).toBe(5_000)
})

test('a compaction resets the growth history', async () => {
  // Big growth before the compaction, small after: only the after counts.
  const before = ends(20_000, 60_000, 100_000, 140_000)
  const compacted = markCompaction(before, 30_000, 10)
  expect(compacted[compacted.length - 1]!.isCompaction).toBe(true)
  let s = compacted
  s = endTurn(s, 33_000, 11)
  s = endTurn(s, 36_000, 12)
  const g = growthRate(s)
  expect(g.rate).toBe(3_000)
  expect(g.basis).toBe(2)
  const f = forecast(s, reading())!
  expect(f.turnsLeft).toBe(Math.ceil((160_000 - 36_000) / 3_000))
})

test('right after a compaction the forecast shows the clearing and waits for growth', async () => {
  const s = markCompaction(ends(100_000, 140_000), 30_000, 5)
  const f = forecast(s, reading())!
  expect(f.level.name).toBe('Clearing')
  expect(f.rate).toBeNull()
  expect(heroText(f)).toBe('Measuring growth')
})

test('over 99 turns reads "Plenty of room"', async () => {
  // +1k a turn with 140k to go: 140 turns.
  const f = forecast(ends(18_000, 19_000, 20_000), reading())!
  expect(f.isPlenty).toBe(true)
  expect(f.turnsLeft).toBeNull()
  expect(heroText(f)).toBe('Plenty of room')
  expect(f.outlook.length).toBe(5)
})

test('exactly 99 turns is still a count', async () => {
  // 99k to go at +1k a turn.
  const f = forecast(ends(59_000, 60_000, 61_000), reading())!
  expect(f.turnsLeft).toBe(TURNS_CAP)
  expect(f.isPlenty).toBe(false)
  expect(heroText(f)).toBe('~99 turns left')
})

test('100 turns crosses the cap', async () => {
  const f = forecast(ends(58_000, 59_000, 60_000), reading())!
  expect(f.isPlenty).toBe(true)
})

test('at the threshold the hero says compaction is next', async () => {
  const f = forecast(ends(140_000, 150_000, 161_000), reading())!
  expect(f.turnsLeft).toBe(0)
  expect(heroText(f)).toBe('Compacting next turn')
  expect(f.level.name).toBe('Storm')
})
