// What the band above the prompt says: one line that answers "how much room
// is left", a limit only when it matters, and an action only when the weather
// calls for one.

import type { WeatherReading, WeatherSample } from '../types'
import { fmtIn, limitName } from './forecast'
import type { Forecast, Level } from './forecast'
import { fmtKs } from './insights'

// A plan limit earns a place in the band from this share up.
export const LIMIT_SHOWN_FROM = 50
const LIMIT_ORDER = ['five_hour', 'seven_day']

export type Band = {
  level: Level
  // The one line, after the condition's name.
  text: string
  // The size behind it, beside the gauge: "368k / 800k".
  figure: string
  // Nothing to act on (Clear, or more than 99 turns left): the band may fold
  // into the footer.
  isCalm: boolean
  // Share of the way to auto-compact (or the window), for the gauge.
  fraction: number
  // Limits at or past LIMIT_SHOWN_FROM, in a fixed order.
  limits: { kind: string; text: string; percent: number }[]
  // Rain offers the planner inline; Storm gives it a row of its own.
  action: 'none' | 'inline' | 'row'
}

function compactedText(samples: readonly WeatherSample[]): string {
  const at = samples.length - 1
  const before = samples[at - 1]
  const after = samples[at]
  return before && after ? `Compacted · ${fmtKs(before.tokens)} → ${fmtKs(after.tokens)}` : 'Compacted'
}

export function buildBand(f: Forecast, r: WeatherReading, samples: readonly WeatherSample[], now: number): Band {
  const target = f.isCompactionLimit ? 'auto-compact' : 'the window fills'
  let text: string
  if (f.level.name === 'Clearing') text = compactedText(samples)
  // With room to spare the share says why the sky is what it is.
  else if (f.isPlenty) text = `${Math.round(f.fraction * 100)}% to ${target}`
  else if (f.turnsLeft === 0) text = f.isCompactionLimit ? 'Auto-compact next turn' : 'Window full'
  else if (f.turnsLeft !== null) text = `~${f.turnsLeft} turn${f.turnsLeft === 1 ? '' : 's'} until ${target}`
  else text = `${Math.round(f.fraction * 100)}% of the way to ${target}`

  const limits = r.limits
    .filter(l => l.percentUsed >= LIMIT_SHOWN_FROM)
    .sort((a, b) => rank(a.kind) - rank(b.kind))
    .map(l => {
      const ms = l.resetsAt ? Date.parse(l.resetsAt) - now : NaN
      const reset = Number.isFinite(ms) ? ` · resets ${fmtIn(ms)}` : ''
      return { kind: l.kind, percent: l.percentUsed, text: `${limitName(l.kind)} ${Math.round(l.percentUsed)}%${reset}` }
    })

  return {
    level: f.level,
    text,
    fraction: f.fraction,
    figure: `${fmtKs(f.tokens)} / ${fmtKs(f.limit)}`,
    // A plan limit near its end is news too.
    isCalm: (f.level.rank === 0 || (f.level.rank === 1 && f.isPlenty)) && !limits.some(l => l.percent >= 75),
    limits,
    action: f.level.rank === 3 ? 'row' : f.level.rank === 2 ? 'inline' : 'none',
  }
}

function rank(kind: string): number {
  const i = LIMIT_ORDER.indexOf(kind)
  return i === -1 ? LIMIT_ORDER.length : i
}
