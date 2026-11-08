// Fixture inputs for the debug preview (/weather debug). They go through the
// same buildPanel as live data, so each state previews the real drawing.

import type { DebugState, SessionScan, WeatherReading, WeatherSample } from '../types'
import type { PanelInput } from './panel'

const MIN = 60_000

function turns(start: number, step: number, n: number, now: number): WeatherSample[] {
  return Array.from({ length: n }, (_, i) => ({
    at: now - (n - i) * 4 * MIN,
    tokens: start + step * i + (i % 3) * 1_200,
    output: 900,
    isCompaction: false,
    isTurnEnd: true,
  }))
}

function reading(threshold: number, groups: [number, number, number, number, number], now: number): WeatherReading {
  const [system, memory, mcp, skills, messages] = groups
  return {
    window: 475_000,
    threshold,
    limits: [
      { kind: 'five_hour', percentUsed: 61, resetsAt: new Date(now + 134 * MIN).toISOString() },
      { kind: 'seven_day', percentUsed: 32, resetsAt: new Date(now + 6 * 24 * 60 * MIN).toISOString() },
    ],
    usd: 4.18,
    startedAt: now - 140 * MIN,
    measuredAt: now,
    categories: [],
    model: 'Opus 5.5',
    barMax: 475_000,
    reserve: 475_000 - threshold,
    groups: [
      { key: 'system', tokens: system },
      { key: 'memory', tokens: memory },
      { key: 'mcp', tokens: mcp },
      { key: 'skills', tokens: skills },
      { key: 'messages', tokens: messages },
    ],
    mcpTools: [
      { name: 'mcp__figma__get_design_context', serverName: 'figma', tokens: 9_800, isLoaded: true },
      { name: 'mcp__github__search_code', serverName: 'github', tokens: 6_100, isLoaded: true },
      { name: 'mcp__linear__list_issues', serverName: 'linear', tokens: 3_200, isLoaded: true },
      { name: 'mcp__sentry__get_issue', serverName: 'sentry', tokens: 2_100, isLoaded: true },
      { name: 'mcp__notion__search', serverName: 'notion', tokens: 1_500, isLoaded: true },
      { name: 'mcp__slack__post', serverName: 'slack', tokens: 1_000, isLoaded: true },
    ],
    claudeMdTokens: 9_300,
  }
}

const scan = (shift: boolean): SessionScan => ({
  turns: [
    { readTokens: 4_000, tokens: 9_000 },
    { readTokens: 21_000, tokens: 26_000 },
    { readTokens: 12_000, tokens: 15_000 },
    { readTokens: 8_000, tokens: 11_000 },
  ],
  editedFiles: 7,
  oldSearch: { count: 9, tokens: 14_200 },
  dumps: { count: 4, tokens: 31_500 },
  failingTests: { tokens: 2_400 },
  calls: { mcp__github__search_code: 3, mcp__linear__list_issues: 1, mcp__sentry__get_issue: 2, mcp__notion__search: 1, mcp__slack__post: 1 },
  messageTokens: 92_600,
  preferences: true,
  shift: shift ? { turnsAgo: 6, tokens: 13_000 } : null,
})

export function fixture(state: Exclude<DebugState, null>, now: number): PanelInput {
  const base = {
    turn: { input: 4, output: 1_100, cacheRead: 166_000, cacheWrite: 1_100 },
    cache: { lastRequestAt: now - 7 * MIN - 50_000, ttlMs: 60 * MIN, read: 166_000, write: 1_100, input: 4 },
    agents: [
      { id: 'a1', type: 'Explore', description: 'search auth flow', input: 84_000, returned: 1_200, isRunning: false },
      { id: 'a2', type: 'general-purpose', description: 'run tests', input: 61_000, returned: 800, isRunning: false },
      { id: 'a3', type: 'code-review', description: 'review diff', input: 22_000, returned: null, isRunning: true },
    ],
    mcpCalls: {},
    overrides: {},
    isTurnRunning: false,
    now,
  }
  if (state === 'clear') {
    return {
      ...base,
      samples: turns(66_000, 2_000, 8, now),
      reading: reading(430_000, [28_400, 6_100, 23_700, 9_200, 13_000], now),
      scan: { ...scan(false), turns: scan(false).turns.map(t => ({ ...t, readTokens: 2_000 })), failingTests: null },
      agents: base.agents.slice(0, 1),
    }
  }
  if (state === 'storm') {
    return {
      ...base,
      samples: turns(300_000, 15_000, 8, now),
      reading: reading(430_000, [28_400, 14_100, 23_700, 9_200, 330_000], now),
      cache: { ...base.cache, lastRequestAt: now - 70 * MIN },
      scan: scan(true),
    }
  }
  // Cloudy, and the planner over the same session.
  return {
    ...base,
    samples: turns(42_000, 18_000, 8, now),
    reading: reading(430_000, [28_400, 14_100, 23_700, 9_200, 92_600], now),
    scan: scan(true),
  }
}
