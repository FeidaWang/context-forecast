// The panel's figures, built from state in one pure step. The live pane and
// the debug fixtures both go through `buildPanel`, so a preview shows exactly
// what live data would. Each field names its source in a comment.

import type { AgentRun, CacheState, Chip, NextMove, SessionScan, WeatherReading, WeatherSample, WeatherTurn } from '../types'
import { forecast, heroText, limitName, fmtIn } from './forecast'
import type { Forecast, Level } from './forecast'
import {
  GROUP_COLOR,
  GROUP_LABEL,
  compactCommand,
  compactInstructions,
  estimateAfter,
  idleHeavyServer,
  mcpServers,
  nextMoves,
  plannerChips,
} from './insights'
import type { McpServerRow } from '../types'

export type PanelInput = {
  samples: readonly WeatherSample[]
  reading: WeatherReading | null
  turn: WeatherTurn | null
  cache: CacheState | null
  agents: readonly AgentRun[]
  scan: SessionScan | null
  mcpCalls: Readonly<Record<string, number>>
  overrides: Readonly<Record<string, boolean>>
  extra?: string
  isTurnRunning: boolean
  now: number
}

export type PanelGroup = { key: string; label: string; tokens: number; color: string }

export type Panel = {
  f: Forecast
  level: Level
  // breakdown.model
  model: string
  // context.tokens (last response's input side) and context.window
  tokens: number
  window: number
  // breakdown.rawMaxTokens: the bar's length; breakdown's `buffer` row: the reserve
  barMax: number
  reserve: number
  usedPercent: number
  hero: string
  // breakdown.autoCompactThreshold; growth = median of turn deltas (forecast.ts)
  threshold: number | null
  growth: number | null
  groups: PanelGroup[]
  mcpServerCount: number
  // An MCP server with big schemas and no calls (breakdown.mcpTools + tool calls)
  mcpFlag: McpServerRow | null
  cache: {
    isWarm: boolean | null
    remainingMs: number | null
    ttlMs: number | null
    readPercent: number | null
    wrote: number | null
    rewrite: number
  } | null
  agents: { rows: AgentRun[]; kept: number } | null
  limits: { kind: string; label: string; percent: number; reset: string | null }[]
  usd: number | null
  moves: NextMove[]
  planner: {
    chips: Chip[]
    instructions: string
    command: string
    before: number
    after: number
    best: { text: string; isGood: boolean }
    canCompact: boolean
  } | null
  isTurnRunning: boolean
}

function resetText(resetsAt: string | undefined, now: number): string | null {
  const at = resetsAt ? Date.parse(resetsAt) : NaN
  if (!Number.isFinite(at)) return null
  const ms = at - now
  if (ms > 48 * 3_600_000) {
    return `resets ${new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  }
  return `resets ${fmtIn(ms)}`
}

export function buildPanel(x: PanelInput): Panel | null {
  const r = x.reading
  const f = forecast(x.samples, r)
  if (!f || !r) return null
  const groups: PanelGroup[] = (r.groups ?? []).map(g => ({
    key: g.key,
    label: GROUP_LABEL[g.key],
    tokens: g.tokens,
    color: GROUP_COLOR[g.key],
  }))
  const servers = mcpServers(r.mcpTools ?? [], { ...(x.scan?.calls ?? {}), ...maxCounts(x.scan?.calls ?? {}, x.mcpCalls) })
  const mcpGroup = groups.find(g => g.key === 'mcp')
  const loadedServers = servers.filter(s => s.tokens > 0).length
  if (mcpGroup && loadedServers > 0) mcpGroup.label = `MCP tools · ${loadedServers} server${loadedServers === 1 ? '' : 's'}`

  let cache: Panel['cache'] = null
  if (x.cache) {
    const c = x.cache
    const total = c.read + c.write + c.input
    const age = x.now - c.lastRequestAt
    cache = {
      isWarm: c.ttlMs === null ? null : age < c.ttlMs,
      remainingMs: c.ttlMs === null ? null : Math.max(0, c.ttlMs - age),
      ttlMs: c.ttlMs,
      readPercent: total > 0 ? Math.round((c.read / total) * 1000) / 10 : null,
      wrote: x.turn ? x.turn.cacheWrite : c.write,
      rewrite: f.tokens,
    }
  }

  const finished = x.agents.filter(a => !a.isRunning && a.returned !== null)
  const agents =
    x.agents.length > 0
      ? { rows: [...x.agents], kept: finished.reduce((a, r) => a + Math.max(0, r.input - (r.returned ?? 0)), 0) }
      : null

  const used = groups.reduce((a, g) => a + g.tokens, 0)
  const messages = groups.find(g => g.key === 'messages')?.tokens ?? 0
  const overhead = Math.max(0, used - messages)

  let planner: Panel['planner'] = null
  if (x.scan) {
    const chips = plannerChips(x.scan, x.overrides)
    const instructions = compactInstructions(chips, x.scan, x.extra ?? '')
    const isWarm = cache?.isWarm
    planner = {
      chips,
      instructions,
      command: compactCommand(instructions),
      before: f.tokens,
      after: estimateAfter(overhead, messages, chips),
      best: x.isTurnRunning
        ? { text: 'After this turn · a turn is running', isGood: false }
        : isWarm === true
          ? { text: 'Now · idle, cache warm', isGood: true }
          : isWarm === false
            ? { text: 'Now · idle, cache already cold', isGood: true }
            : { text: 'Now · idle', isGood: true },
      canCompact: !x.isTurnRunning,
    }
  }

  return {
    f,
    level: f.level,
    model: r.model ?? '',
    tokens: f.tokens,
    window: r.window,
    barMax: r.barMax ?? r.window,
    reserve: r.reserve ?? 0,
    usedPercent: Math.round((f.tokens / (r.barMax ?? r.window)) * 100),
    hero: heroText(f),
    threshold: r.threshold,
    growth: f.rate,
    groups,
    mcpServerCount: loadedServers,
    mcpFlag: idleHeavyServer(servers),
    cache,
    agents,
    limits: r.limits.map(l => ({
      kind: l.kind,
      label: limitName(l.kind, true).replace(' limit', '').replace(/^5-hour$/, '5-hour session'),
      percent: l.percentUsed,
      reset: resetText(l.resetsAt, x.now),
    })),
    usd: r.usd,
    moves: x.scan ? nextMoves(x.scan, r.claudeMdTokens ?? 0, overhead, f.tokens) : [],
    planner,
    isTurnRunning: x.isTurnRunning,
  }
}

// Calls counted live since the mod loaded, beside those the conversation
// still holds: the larger of the two per tool, so neither double counts.
function maxCounts(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = Math.max(a[k] ?? 0, b[k] ?? 0)
  return out
}
