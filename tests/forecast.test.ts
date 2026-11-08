import { expect, test } from 'claude-code/testing'

import type { WeatherReading, WeatherSample } from '../types'
import {
  addRequest,
  BAD,
  CLEARING,
  endTurn,
  fmtIn,
  fmtCount,
  fmtUsd,
  forecast,
  GOOD,
  growthRate,
  levelOf,
  limitName,
  meter,
  SERIOUS,
  severity,
  turnsPhrase,
  WARN,
} from '../hooks/forecast'
import { parseTranscript } from '../hooks/history'
import { SKY_COLUMNS, skyBody, skyCells, skySvg } from '../hooks/sky'
import { LEVELS } from '../hooks/forecast'

const reading = (threshold: number | null = 160_000): WeatherReading => ({
  window: 200_000,
  threshold,
  limits: [],
  usd: null,
  startedAt: 0,
  measuredAt: 0,
  categories: [],
})

const turn = (tokens: number, extra: Partial<WeatherSample> = {}): WeatherSample => ({
  at: 0,
  tokens,
  output: 0,
  isCompaction: false,
  isTurnEnd: true,
  ...extra,
})

test('levelOf maps the fraction to a condition at each boundary', async () => {
  const name = (f: number) => levelOf(f).name
  expect(name(0)).toBe('Clear')
  expect(name(0.299)).toBe('Clear')
  expect(name(0.3)).toBe('Cloudy')
  expect(name(0.599)).toBe('Cloudy')
  expect(name(0.6)).toBe('Rain')
  expect(name(0.849)).toBe('Rain')
  expect(name(0.85)).toBe('Storm')
  expect(name(3)).toBe('Storm')
})

test('severity colors rate-limit percentages', async () => {
  expect(severity(0)).toBe(GOOD)
  expect(severity(49)).toBe(GOOD)
  expect(severity(50)).toBe(WARN)
  expect(severity(75)).toBe(SERIOUS)
  expect(severity(90)).toBe(BAD)
})

test('formatters', async () => {
  expect(fmtCount(999)).toBe('999')
  expect(fmtCount(1000)).toBe('1k')
  expect(fmtCount(1500)).toBe('1.5k')
  expect(fmtCount(12_000)).toBe('12k')
  expect(fmtCount(150_400)).toBe('150k')
  expect(fmtCount(1_500_000)).toBe('1.5M')
  expect(fmtUsd(1.234)).toBe('$1.23')
  expect(fmtUsd(12.34)).toBe('$12.3')
  expect(limitName('five_hour')).toBe('5h')
  expect(limitName('five_hour', true)).toBe('5-hour limit')
  expect(limitName('seven_day')).toBe('7d')
  expect(limitName('spend_limit', true)).toBe('Spend limit')
  expect(limitName('some_other_kind')).toBe('some other kind')
  expect(fmtIn(0)).toBe('now')
  expect(fmtIn(-5)).toBe('now')
  expect(fmtIn(30 * 60_000)).toBe('30m')
  expect(fmtIn(90 * 60_000)).toBe('1h 30m')
  expect(fmtIn(49 * 3_600_000)).toBe('2d')
})

test('meter clamps and splits', async () => {
  expect(meter(0.5, 10)).toEqual(['━━━━━', '─────'])
  expect(meter(2, 4)).toEqual(['━━━━', ''])
  expect(meter(-1, 4)).toEqual(['', '────'])
})

test('addRequest ignores repeats, flags compaction, and caps history', async () => {
  let s: WeatherSample[] = []
  s = addRequest(s, 50_000, 10, 1)
  expect(s).toHaveLength(1)
  expect(addRequest(s, 50_000, 10, 2)).toBe(s)
  s = addRequest(s, 80_000, 10, 3)
  expect(s[1]!.isCompaction).toBe(false)
  s = addRequest(s, 20_000, 10, 4)
  expect(s[2]!.isCompaction).toBe(true)
  let many: WeatherSample[] = []
  for (let i = 1; i <= 450; i += 1) many = addRequest(many, i * 10, 0, i)
  expect(many).toHaveLength(400)
})

test('endTurn closes the turn on the session reading', async () => {
  const s = endTurn([turn(10_000, { isTurnEnd: false })], 10_000, 1)
  expect(s).toHaveLength(1)
  expect(s[0]!.isTurnEnd).toBe(true)
  const t = endTurn(s, 12_000, 2)
  expect(t).toHaveLength(2)
  expect(t[1]!.isTurnEnd).toBe(true)
  expect(endTurn(t, 12_000, 3)).toBe(t)
})

test('forecast returns null without data', async () => {
  expect(forecast([], reading())).toBeNull()
  expect(forecast([turn(1000)], null)).toBeNull()
})

test('forecast estimates turns left from median growth', async () => {
  const f = forecast([turn(10_000), turn(20_000), turn(30_000)], reading())!
  expect(f.rate).toBe(10_000)
  expect(f.rateBasis).toBe(2)
  expect(f.turnsLeft).toBe(13)
  expect(f.isCompactionLimit).toBe(true)
  expect(f.level.name).toBe('Clear')
  expect(f.outlook).toHaveLength(5)
  expect(turnsPhrase(f)).toBe('~13 turns to compaction')
})

test('forecast falls back to the window when compaction is off', async () => {
  const f = forecast([turn(10_000), turn(20_000)], reading(null))!
  expect(f.limit).toBe(200_000)
  expect(f.isCompactionLimit).toBe(false)
  expect(turnsPhrase(f)).toBe('~18 turns to full')
})

test('forecast phrases: singular, at limit, and unknown growth', async () => {
  const one = forecast([turn(135_000), turn(145_000), turn(155_000)], reading())!
  expect(turnsPhrase(one)).toBe('~1 turn to compaction')
  const at = forecast([turn(140_000), turn(150_000), turn(160_000)], reading())!
  expect(at.turnsLeft).toBe(0)
  expect(turnsPhrase(at)).toBe('at compaction')
  const flat = forecast([turn(50_000), turn(50_000)], reading())!
  expect(flat.rate).toBe(0)
  expect(flat.turnsLeft).toBeNull()
  expect(flat.isPlenty).toBe(true)
  expect(turnsPhrase(flat)).toBeNull()
  const none = forecast([turn(50_000)], reading())!
  expect(none.rate).toBeNull()
  expect(none.isPlenty).toBe(false)
  expect(growthRate([])).toEqual({ rate: null, basis: 0 })
})

test('a compaction shows the clearing', async () => {
  const f = forecast([turn(100_000), turn(120_000), turn(50_000, { isCompaction: true })], reading())!
  expect(f.level.name).toBe(CLEARING.name)
})

test('transcript parsing tolerates junk', async () => {
  expect(parseTranscript('')).toEqual([])
  expect(parseTranscript('not json\n{broken\n')).toEqual([])
  const zero = JSON.stringify({ type: 'assistant', requestId: 'z', message: { usage: { input_tokens: 0 } } })
  expect(parseTranscript(zero)).toEqual([])
})

test('every sky level draws', async () => {
  expect(SKY_COLUMNS).toBe(3)
  for (const level of [...LEVELS, CLEARING]) {
    expect(skyBody(level).length).toBeGreaterThan(0)
    expect(skySvg(level, 32)).toContain('<svg')
    expect(skyCells(level, 0).length).toBeGreaterThan(0)
  }
})
