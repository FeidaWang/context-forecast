import type { WeatherReading, WeatherSample } from '../types'
import { SKY_DEFS, SKY_STYLE, skyBody } from './sky'

// `art` picks the sky drawing (sky.ts), kept apart from `rank` so the scale can
// change without redrawing the skies.
export type Level = { rank: number; art: number; icon: string; name: string; color: string; tag: string }

// Conditions by how far the context is toward the auto-compact threshold (or
// the window when auto-compaction is off). Rank 4 is the clearing right after
// a compaction.
// Conditions are states, so they wear the status palette, each always shown
// with its icon and name, never by color alone.
export const GOOD = '#0ca30c'
export const WARN = '#fab219'
export const SERIOUS = '#ec835a'
export const BAD = '#d03b3b'
// Cloudy is a state to know, not a warning: a calm blue.
export const CALM = '#4a8fe0'

export const LEVELS: readonly Level[] = [
  { rank: 0, art: 0, icon: '☀️', name: 'Clear', color: GOOD, tag: 'plenty of room' },
  { rank: 1, art: 2, icon: '☁️', name: 'Cloudy', color: CALM, tag: 'filling up' },
  { rank: 2, art: 3, icon: '🌧️', name: 'Rain', color: SERIOUS, tag: 'compaction ahead' },
  { rank: 3, art: 4, icon: '⛈️', name: 'Storm', color: BAD, tag: 'compaction imminent' },
]
export const CLEARING: Level = {
  rank: 4,
  art: 5,
  icon: '🌈',
  name: 'Clearing',
  color: GOOD,
  tag: 'just compacted',
}

// Share of the auto-compact threshold where each condition starts.
export const CUTS = [0.3, 0.6, 0.85]
// The ranks that warn: Rain and Storm.
export const isAlertRank = (rank: number) => rank === 2 || rank === 3
// Past this many turns the hero reads "Plenty of room".
export const TURNS_CAP = 99

export function levelOf(fraction: number): Level {
  const rank = CUTS.findIndex(cut => fraction < cut)
  return LEVELS[rank === -1 ? LEVELS.length - 1 : rank]!
}

export function severity(percent: number): string {
  return percent >= 90 ? BAD : percent >= 75 ? SERIOUS : percent >= 50 ? WARN : GOOD
}

export type Outlook = { step: number; tokens: number; fraction: number; level: Level; isPast: boolean }

export type Forecast = {
  tokens: number
  window: number
  limit: number
  isCompactionLimit: boolean
  fraction: number
  windowPercent: number
  level: Level
  rate: number | null
  rateBasis: number
  perRequest: number | null
  requestsPerTurn: number
  turns: number
  turnsLeft: number | null
  // More than TURNS_CAP turns left, or no growth at all: "Plenty of room".
  isPlenty: boolean
  outlook: Outlook[]
  lastTurn: { requests: number; growth: number; output: number } | null
}

// The samples since the latest compaction (that sample included).
function sinceCompaction(samples: readonly WeatherSample[]): readonly WeatherSample[] {
  let start = 0
  samples.forEach((s, i) => {
    if (s.isCompaction) start = i
  })
  return samples.slice(start)
}

function turnEnds(samples: readonly WeatherSample[]): WeatherSample[] {
  const ends = samples.filter(s => s.isTurnEnd)
  const last = samples[samples.length - 1]
  if (last && !last.isTurnEnd) ends.push(last)
  return ends
}

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

// Growth per turn: the median of the last ≤8 turn-to-turn deltas since the
// latest compaction, negative deltas left out (a shrink is not growth), so one
// spike moves it little. Before two turn ends exist, the growth across the one
// turn seen. `basis` is how many deltas it stands on; `rate` is null until a
// delta exists, and 0 when the context has held still.
export function growthRate(samples: readonly WeatherSample[]): { rate: number | null; basis: number } {
  const recent = sinceCompaction(samples)
  const ends = turnEnds(recent)
  const deltas: number[] = []
  for (let i = 1; i < ends.length; i += 1) {
    const d = ends[i]!.tokens - ends[i - 1]!.tokens
    if (d >= 0) deltas.push(d)
  }
  const last8 = deltas.slice(-8)
  if (last8.length > 0) return { rate: median(last8), basis: last8.length }
  const first = recent[0]
  const last = recent[recent.length - 1]
  return first && last && last.tokens > first.tokens ? { rate: last.tokens - first.tokens, basis: 1 } : { rate: null, basis: 0 }
}

// The requests of the last completed turn (or the one running).
function lastTurnOf(samples: readonly WeatherSample[]): WeatherSample[] {
  let end = samples.length - 1
  if (end < 0) return []
  let start = end
  while (start > 0 && !samples[start - 1]!.isTurnEnd) start -= 1
  return samples.slice(start, end + 1)
}

export function forecast(samples: readonly WeatherSample[], reading: WeatherReading | null): Forecast | null {
  const last = samples[samples.length - 1]
  if (!last || !reading || reading.window <= 0) return null
  const limit = reading.threshold && reading.threshold > 0 ? reading.threshold : reading.window
  const fraction = last.tokens / limit
  const { rate, basis: rateBasis } = growthRate(samples)
  const raw =
    rate === null ? null : last.tokens >= limit ? 0 : rate <= 0 ? Infinity : Math.max(1, Math.ceil((limit - last.tokens) / rate))
  const isPlenty = raw !== null && raw > TURNS_CAP
  const turnsLeft = raw === null || isPlenty ? null : raw
  const outlook: Outlook[] = []
  if (rate !== null && rate > 0) {
    for (let step = 1; step <= 5; step += 1) {
      const tokens = last.tokens + rate * step
      const f = tokens / limit
      outlook.push({ step, tokens, fraction: f, level: levelOf(f), isPast: f >= 1 })
    }
  }
  const recent = sinceCompaction(samples)
  const ends = samples.filter(s => s.isTurnEnd).length
  const requestsPerTurn = ends > 0 ? samples.length / ends : samples.length
  let perRequest: number | null = null
  if (recent.length >= 2) {
    const d = recent[recent.length - 1]!.tokens - recent[0]!.tokens
    perRequest = d > 0 ? d / (recent.length - 1) : null
  }
  const turn = lastTurnOf(samples)
  const before = samples[samples.length - turn.length - 1]
  const lastTurn =
    turn.length > 0
      ? {
          requests: turn.length,
          growth: last.tokens - (before && !turn[0]!.isCompaction ? before.tokens : turn[0]!.tokens),
          output: turn.reduce((a, s) => a + s.output, 0),
        }
      : null

  return {
    tokens: last.tokens,
    window: reading.window,
    limit,
    isCompactionLimit: limit !== reading.window,
    fraction,
    windowPercent: Math.round((last.tokens / reading.window) * 100),
    level: last.isCompaction ? CLEARING : levelOf(fraction),
    rate,
    rateBasis,
    perRequest,
    requestsPerTurn,
    turns: ends + (last.isTurnEnd ? 0 : 1),
    turnsLeft,
    isPlenty,
    outlook,
    lastTurn,
  }
}

// The hero line of the panel.
export function heroText(f: Forecast): string {
  // With room to spare the share says why the sky is what it is (as the band).
  if (f.isPlenty) return `${Math.round(f.fraction * 100)}% to ${f.isCompactionLimit ? 'auto-compact' : 'full'}`
  if (f.turnsLeft === null) return 'Measuring growth'
  if (f.turnsLeft === 0) return f.isCompactionLimit ? 'Compacting next turn' : 'Window full'
  return `~${f.turnsLeft} turn${f.turnsLeft === 1 ? '' : 's'} left`
}

// Adds one model request's reading; the same figure twice in a row is one.
export function addRequest(samples: readonly WeatherSample[], tokens: number, output: number, at: number): WeatherSample[] {
  const prev = samples[samples.length - 1]
  if (prev && prev.tokens === tokens && !prev.isTurnEnd) return samples as WeatherSample[]
  const isCompaction = prev !== undefined && tokens < prev.tokens * 0.7
  return [...samples, { at, tokens, output, isCompaction, isTurnEnd: false }].slice(-400)
}

// A compaction the engine reported (`session.compact`'s `tokensAfter`): the
// point the forecast restarts from, so growth only counts what follows it.
export function markCompaction(samples: readonly WeatherSample[], tokens: number, at: number): WeatherSample[] {
  return [...samples, { at, tokens, output: 0, isCompaction: true, isTurnEnd: true }].slice(-400)
}

// Closes the turn at the session's own reading of the context.
export function endTurn(samples: readonly WeatherSample[], tokens: number, at: number): WeatherSample[] {
  const prev = samples[samples.length - 1]
  if (prev && prev.tokens === tokens) {
    return prev.isTurnEnd ? (samples as WeatherSample[]) : [...samples.slice(0, -1), { ...prev, isTurnEnd: true }]
  }
  const list = addRequest(samples, tokens, 0, at)
  const last = list[list.length - 1]!
  return [...list.slice(0, -1), { ...last, isTurnEnd: true }]
}

export function fmtCount(n: number): string {
  if (n >= 1e6) return `${trim(n / 1e6)}M`
  if (n >= 1e3) return `${n >= 1e5 ? Math.round(n / 1e3) : trim(n / 1e3)}k`
  return `${Math.round(n)}`
}

function trim(x: number): string {
  return x.toFixed(1).replace(/\.0$/, '')
}

export function fmtUsd(usd: number): string {
  return usd < 10 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(1)}`
}

export function limitName(kind: string, isLong = false): string {
  if (kind === 'five_hour') return isLong ? '5-hour limit' : '5h'
  if (kind === 'seven_day') return isLong ? 'Weekly limit' : '7d'
  if (kind === 'spend_limit') return isLong ? 'Spend limit' : 'spend'
  return kind.replace(/_/g, ' ')
}

// Each condition's span of the way to auto-compact, for the terminal's scale.
export const LEVEL_SPANS: readonly { level: Level; range: string }[] = [
  { level: LEVELS[0]!, range: '<30%' },
  { level: LEVELS[1]!, range: '30–60%' },
  { level: LEVELS[2]!, range: '60–85%' },
  { level: LEVELS[3]!, range: '85%+' },
]

export function fmtIn(ms: number): string {
  if (ms <= 0) return 'now'
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  if (h < 48) return `1d ${h - 24}h`
  return `${Math.round(h / 24)}d`
}

export function turnsPhrase(f: Forecast): string | null {
  if (f.turnsLeft === null) return null
  const what = f.isCompactionLimit ? 'compaction' : 'full'
  if (f.turnsLeft === 0) return `at ${what}`
  return `~${f.turnsLeft} turn${f.turnsLeft === 1 ? '' : 's'} to ${what}`
}

// ---- drawing data -------------------------------------------------------------

const BARS = '▁▂▃▄▅▆▇█'
const DEFAULT = 0x01000000

function hex(color: string): number {
  return parseInt(color.slice(1), 16)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += B64[a >> 2]
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : B64[c & 63]
  }
  return out
}

function pack(words: number[]): string {
  return base64(new Uint8Array(Uint32Array.from(words).buffer))
}

function fractions(samples: readonly WeatherSample[], limit: number, count: number): (WeatherSample & { f: number })[] {
  return samples.slice(-count).map(s => ({ ...s, f: Math.max(0, s.tokens / limit) }))
}

function sampleColor(s: { f: number; isCompaction: boolean }): number {
  return hex(s.isCompaction ? CLEARING.color : levelOf(s.f).color)
}

// Multi-row bar chart for the terminal pane: newest request on the right, the
// top row is the compaction line.
export function chartCells(samples: readonly WeatherSample[], limit: number, columns: number, rows: number) {
  const pts = fractions(samples, limit, columns)
  const words: number[] = []
  const line = hex(BAD)
  const pad = columns - pts.length
  for (let r = 0; r < rows; r += 1) {
    const fromBottom = rows - 1 - r
    for (let c = 0; c < columns; c += 1) {
      const p = c >= pad ? pts[c - pad] : undefined
      const eighths = p ? Math.round(Math.min(1, p.f) * rows * 8) : 0
      const fill = eighths - fromBottom * 8
      if (p && fill > 0) {
        words.push(BARS.codePointAt(Math.min(8, fill) - 1)!, sampleColor(p), DEFAULT)
      } else if (r === 0) {
        words.push(0x2508, line, DEFAULT)
      } else {
        words.push(0x20, DEFAULT, DEFAULT)
      }
    }
  }
  return { columns, rows, cells: pack(words) }
}

// A text meter for the terminal: filled and empty segments as two strings so
// the caller colors them apart.
export function meter(fraction: number, width: number): [string, string] {
  const n = Math.round(Math.min(1, Math.max(0, fraction)) * width)
  return ['━'.repeat(n), '─'.repeat(width - n)]
}

const FONT = 'font-family="-apple-system,BlinkMacSystemFont,system-ui,sans-serif"'
const MUTED = '#8a8f98'

// The desktop lays text out at about seven pixels a cell, so a graphic sized
// from `bodyColumns` draws at its slot's width and never scales its text.
export const PX_PER_CELL = 7

export function pxFor(columns: number, min = 120, max = 900): number {
  return Math.round(Math.max(min, Math.min(max, columns * PX_PER_CELL)))
}

// The pane's graphics take the slot's width: drawn a little wider than the
// pane's cells measure, the surface scales them down to fit exactly.
export function panePx(columns: number): number {
  return Math.round(Math.max(240, Math.min(1100, columns * 8.4)))
}

// Categorical slots for what fills the context, fixed order (validated set).
export const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300']

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function svgOpen(w: number, h: number, extra = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ${FONT} ${extra}>`
}

// The band's gauge: the context filled toward the auto-compact point (the
// bar's end), the next five turns as a paler run ahead of it.
export function gaugeSvg(f: Forecast, w: number): string {
  const h = 20
  const y = 7
  const bh = 6
  const now = Math.min(1, f.fraction) * w
  return (
    svgOpen(w, h) +
    `<rect x="0" y="${y}" width="${w}" height="${bh}" rx="3" fill="${f.level.color}" fill-opacity=".18"/>` +
    `<rect x="0" y="${y}" width="${Math.max(3, now).toFixed(1)}" height="${bh}" rx="3" fill="${f.level.color}"/>` +
    `<rect x="${(w - 2).toFixed(1)}" y="4" width="2" height="${h - 8}" rx="1" fill="${markerColor(f)}" fill-opacity=".7"/>` +
    '</svg>'
  )
}

// The auto-compact mark at the gauge's end: neutral until the weather turns.
function markerColor(f: Forecast): string {
  return f.level.rank === 2 || f.level.rank === 3 ? BAD : MUTED
}

// A meter: severity in the fill, the same hue paler in the track.
export function meterSvg(fraction: number, color: string, w: number): string {
  const h = 8
  const fw = Math.max(fraction > 0 ? 4 : 0, Math.min(1, Math.max(0, fraction)) * w)
  return (
    svgOpen(w, h) +
    `<rect x="0" y="1" width="${w}" height="6" rx="3" fill="${color}" fill-opacity=".2"/>` +
    `<rect x="0" y="1" width="${fw.toFixed(1)}" height="6" rx="3" fill="${color}"/>` +
    '</svg>'
  )
}

export type Slice = { name: string; tokens: number; color: string }

// One stacked bar of the used tokens, 2px gaps between parts.
export function stackSvg(slices: readonly Slice[], total: number, w: number): string {
  const h = 10
  const parts = [svgOpen(w, h), `<clipPath id="c"><rect x="0" y="0" width="${w}" height="${h}" rx="4"/></clipPath><g clip-path="url(#c)">`]
  let x = 0
  for (const s of slices) {
    const sw = (s.tokens / total) * w
    if (sw >= 0.5) parts.push(`<rect x="${x.toFixed(1)}" y="0" width="${Math.max(0.5, sw - 2).toFixed(1)}" height="${h}" fill="${s.color}"/>`)
    x += sw
  }
  parts.push('</g></svg>')
  return parts.join('')
}

function areaPath(pts: { x: number; y: number }[], base: number): { line: string; area: string } {
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('')
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  return { line, area: `${line}L${last.x.toFixed(1)},${base}L${first.x.toFixed(1)},${base}Z` }
}

// The forecast chart for the desktop pane at the pane's width: every request,
// turn ends as ticks you can hover, the next five turns dashed, the
// auto-compact line, a rainbow where compaction struck.
export function chartSvg(samples: readonly WeatherSample[], f: Forecast, w: number): string {
  const h = Math.round(Math.max(130, Math.min(200, w * 0.4)))
  const left = 34
  const right = 6
  const top = 18
  const bottom = 20
  const plotW = w - left - right
  const plotH = h - top - bottom
  const pts = fractions(samples, f.limit, Math.max(40, Math.round(plotW / 3)))
  const gap = Math.max(1, Math.min(12, Math.round(f.requestsPerTurn)))
  const span = Math.max(2, pts.length + f.outlook.length * gap)
  const step = plotW / (span - 1)
  const yOf = (fr: number) => top + plotH * (1 - Math.min(1.1, fr) / 1.1)
  const xy = pts.map((p, i) => ({ x: left + i * step, y: yOf(p.f) }))
  const color = f.level.color
  const parts: string[] = [
    svgOpen(w, h, 'font-size="11" style="color-scheme:light dark"'),
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".32"/>`,
    `<stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`,
  ]
  for (const g of [0.25, 0.5, 0.75]) {
    const y = yOf(g).toFixed(1)
    parts.push(`<line x1="${left}" x2="${w - right}" y1="${y}" y2="${y}" stroke="${MUTED}" stroke-opacity=".22"/>`)
    parts.push(`<text x="${left - 6}" y="${(+y + 4).toFixed(1)}" text-anchor="end" fill="${MUTED}">${g * 100}%</text>`)
  }
  const ly = yOf(1).toFixed(1)
  parts.push(
    `<line x1="${left}" x2="${w - right}" y1="${ly}" y2="${ly}" stroke="${BAD}" stroke-width="1.5" stroke-dasharray="4 4" stroke-opacity=".75"/>`,
    `<text x="${left - 6}" y="${(+ly + 4).toFixed(1)}" text-anchor="end" fill="${MUTED}">100%</text>`,
    `<text x="${w - right}" y="${(+ly - 5).toFixed(1)}" text-anchor="end" fill="${MUTED}">` +
      `${f.isCompactionLimit ? 'auto-compact' : 'window full'} · ${fmtCount(f.limit)}</text>`,
  )
  if (xy.length >= 2) {
    const { line, area } = areaPath(xy, h - bottom)
    parts.push(`<path d="${area}" fill="url(#g)"/>`)
    parts.push(`<path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`)
  }
  let turn = 0
  pts.forEach((p, i) => {
    const x = left + i * step
    if (p.isCompaction) {
      parts.push(`<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${top}" y2="${h - bottom}" stroke="${MUTED}" stroke-opacity=".5" stroke-dasharray="1 3"/>`)
      parts.push(`<text x="${x.toFixed(1)}" y="${h - 4}" text-anchor="middle">🌈</text>`)
    }
    if (p.isTurnEnd) {
      turn += 1
      parts.push(`<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${h - bottom}" y2="${h - bottom + 4}" stroke="${MUTED}" stroke-opacity=".6"/>`)
      parts.push(
        `<circle cx="${x.toFixed(1)}" cy="${xy[i]!.y.toFixed(1)}" r="7" fill="transparent">` +
          `<title>End of a turn · ${fmtCount(p.tokens)} (${Math.round(p.f * 100)}% of auto-compact)</title></circle>`,
      )
    }
  })
  const end = xy[xy.length - 1]
  if (end) {
    if (f.outlook.length > 0) {
      const ahead = [end, ...f.outlook.map((o, i) => ({ x: end.x + (i + 1) * gap * step, y: yOf(o.fraction) }))]
      const d = ahead.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('')
      parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="2 5" stroke-linecap="round" stroke-opacity=".7"/>`)
      ahead.slice(1).forEach((p, i) => {
        const o = f.outlook[i]!
        parts.push(
          `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${o.level.color}" stroke="${o.level.color}" stroke-opacity=".25" stroke-width="6">` +
            `<title>In ${o.step} turn${o.step === 1 ? '' : 's'} · ~${fmtCount(o.tokens)} (${Math.round(o.fraction * 100)}%) · ${o.level.name}</title></circle>`,
        )
      })
      parts.push(`<text x="${w - right}" y="${h - 4}" text-anchor="end" fill="${MUTED}">+5 turns</text>`)
    }
    parts.push(
      `<circle cx="${end.x.toFixed(1)}" cy="${end.y.toFixed(1)}" r="4.5" fill="${color}" stroke="${color}" stroke-opacity=".3" stroke-width="6">` +
        `<title>Now · ${fmtCount(f.tokens)} (${Math.round(f.fraction * 100)}% of auto-compact)</title></circle>`,
    )
    if (end.x > left + 60 && end.x < w - right - 70) {
      parts.push(`<text x="${end.x.toFixed(1)}" y="${h - 4}" text-anchor="middle" fill="${MUTED}">now</text>`)
    }
  }
  parts.push(`<text x="${left}" y="${h - 4}" fill="${MUTED}">${turn} turn${turn === 1 ? '' : 's'} ago</text>`)
  parts.push('</svg>')
  return parts.join('')
}

// The same stacked bar for the terminal pane: one row of colored cells.
export function stackCells(slices: readonly Slice[], total: number, columns: number) {
  const words: number[] = []
  let filled = 0
  slices.forEach((s, i) => {
    const n = i === slices.length - 1 ? columns - filled : Math.round((s.tokens / total) * columns)
    for (let k = 0; k < n && filled < columns; k += 1, filled += 1) words.push(0x2588, hex(s.color), DEFAULT)
  })
  while (filled < columns) {
    words.push(0x2591, hex(MUTED), DEFAULT)
    filled += 1
  }
  return { columns, rows: 1, cells: pack(words) }
}

// The band's gauge on the terminal: filled cells, the projection paler, the
// rest a dim track, the last cell the auto-compact mark.
export function gaugeCells(f: Forecast, columns: number) {
  const words: number[] = []
  const now = Math.round(Math.min(1, f.fraction) * columns)
  const color = hex(f.level.color)
  for (let c = 0; c < columns; c += 1) {
    if (c === columns - 1 && now < columns) words.push(0x2502, hex(markerColor(f)), DEFAULT)
    else if (c < Math.max(1, now)) words.push(0x2588, color, DEFAULT)
    else words.push(0x2591, hex(MUTED), DEFAULT)
  }
  return { columns, rows: 1, cells: pack(words) }
}

// The weather scale for the pane: each condition's span of the way to
// auto-compact, its drawn sky above (the current one animated), a marker at now.
export function scaleSvg(f: Forecast, w: number): string {
  const h = 78
  const cuts = [0, ...CUTS, 1]
  const LAST = LEVELS.length - 1
  const parts = [
    svgOpen(w, h, 'font-size="11"'),
    SKY_STYLE.replace('</style>', '.still *{animation:none!important}</style>'),
    SKY_DEFS,
  ]
  LEVELS.forEach((level, i) => {
    const x0 = cuts[i]! * w
    const x1 = cuts[i + 1]! * w
    const mid = (x0 + x1) / 2
    const isNow = f.level.rank === level.rank
    const icon = isNow ? 24 : 20
    parts.push(
      `<g class="${isNow ? '' : 'still'}" opacity="${isNow ? 1 : 0.75}"><svg x="${(mid - icon / 2).toFixed(1)}" y="${isNow ? 0 : 3}" width="${icon}" height="${icon}" viewBox="0 0 32 32" overflow="visible">${skyBody(level)}</svg></g>`,
      `<rect x="${(x0 + (i === 0 ? 0 : 1)).toFixed(1)}" y="32" width="${(x1 - x0 - (i === 0 || i === LAST ? 1 : 2)).toFixed(1)}" height="6" ` +
        `${i === 0 || i === LAST ? 'rx="3"' : ''} fill="${level.color}" fill-opacity="${isNow ? 1 : 0.3}"/>`,
      `<text x="${mid.toFixed(1)}" y="55" text-anchor="middle" fill="${MUTED}" font-weight="${isNow ? 700 : 400}">${level.name}</text>`,
      `<text x="${mid.toFixed(1)}" y="70" text-anchor="middle" fill="${MUTED}" font-size="10" opacity=".8">` +
        `${i === LAST ? `${Math.round(cuts[i]! * 100)}%+` : `${Math.round(cuts[i]! * 100)}–${Math.round(cuts[i + 1]! * 100)}%`}</text>`,
    )
  })
  const mx = Math.max(4, Math.min(w - 4, Math.min(1, f.fraction) * w))
  parts.push(`<path d="M${(mx - 4).toFixed(1)} 26L${(mx + 4).toFixed(1)} 26L${mx.toFixed(1)} 31Z" fill="${MUTED}"/>`)
  parts.push('</svg>')
  return parts.join('')
}
