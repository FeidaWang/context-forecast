import { expect, test } from 'claude-code/testing'

import {
  compactInstructions,
  estimateAfter,
  fmtK,
  fmtKs,
  groupCategories,
  idleHeavyServer,
  mcpServers,
  nextMoves,
  plannerChips,
  scanSession,
  serverOfTool,
  topicShift,
} from '../hooks/insights'
import type { Row } from '../hooks/insights'
import { inferTtl, lastCacheTtl, subagentPeak } from '../hooks/history'
import { isAppServer, modelName } from '../hooks/insights'
import { fmtIn } from '../hooks/forecast'
import { buildPanel } from '../hooks/panel'
import { fixture } from '../hooks/fixtures'
import { buildBand } from '../hooks/band'
import { forecast } from '../hooks/forecast'
import { markCompaction } from '../hooks/forecast'
import { cacheLeft } from '../hooks/pane'

const prompt = (text: string): Row => ({ role: 'user', text, toolUses: [] })
const call = (tool: string, input: Record<string, unknown>, text = '', isError?: true): Row => ({
  role: 'assistant',
  text: '',
  toolUses: [{ tool, input, text, ...(isError ? { isError } : {}) }],
})

test('k values: one decimal, thousands separators', async () => {
  expect(fmtK(999)).toBe('999')
  expect(fmtK(28_400)).toBe('28.4k')
  expect(fmtK(168_000)).toBe('168.0k')
  expect(fmtK(1_000_000)).toBe('1,000.0k')
  // Summary figures: whole k from 10k up.
  expect(fmtKs(9_300)).toBe('9.3k')
  expect(fmtKs(168_400)).toBe('168k')
  expect(fmtKs(1_000_000)).toBe('1M')
  expect(fmtKs(1_500_000)).toBe('1.5M')
  expect(fmtKs(967_000)).toBe('967k')
})

test('categories fold into the panel groups; free, buffer and deferred stay out', async () => {
  const g = groupCategories([
    { name: 'System prompt', tokens: 2_700, kind: 'used' },
    { name: 'System tools', tokens: 31_000, kind: 'used' },
    { name: 'System tools (deferred)', tokens: 30_800, kind: 'deferred' },
    { name: 'MCP tools', tokens: 23_700, kind: 'used' },
    { name: 'Memory files', tokens: 14_100, kind: 'used' },
    { name: 'Skills', tokens: 2_300, kind: 'used' },
    { name: 'Custom agents', tokens: 900, kind: 'used' },
    { name: 'Messages', tokens: 92_600, kind: 'used' },
    { name: 'Free space', tokens: 800_000, kind: 'free' },
    { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
  ])
  expect(g).toEqual([
    { key: 'system', tokens: 33_700 },
    { key: 'memory', tokens: 14_100 },
    { key: 'mcp', tokens: 23_700 },
    { key: 'skills', tokens: 3_200 },
    { key: 'messages', tokens: 92_600 },
  ])
})

test('MCP: schema tokens per server, calls mapped, idle heavy server flagged', async () => {
  expect(serverOfTool('mcp__claude-in-chrome__navigate')).toBe('claude-in-chrome')
  expect(serverOfTool('Read')).toBeNull()
  const servers = mcpServers(
    [
      { name: 'mcp__figma__a', serverName: 'figma', tokens: 6_000, isLoaded: true },
      { name: 'mcp__figma__b', serverName: 'figma', tokens: 3_800, isLoaded: true },
      { name: 'mcp__github__c', serverName: 'github', tokens: 7_000, isLoaded: true },
      { name: 'mcp__lazy__d', serverName: 'lazy', tokens: 9_000, isLoaded: false },
    ],
    { mcp__github__c: 2 },
  )
  expect(servers.find(s => s.name === 'figma')).toEqual({ name: 'figma', tokens: 9_800, calls: 0 })
  expect(servers.find(s => s.name === 'lazy')!.tokens).toBe(0)
  expect(idleHeavyServer(servers)?.name).toBe('figma')
})

test('scan: edited files, old searches, dumps, failing tests, read volume', async () => {
  const big = 'x'.repeat(24_000)
  const scan = scanSession([
    prompt('Fix the login bug in auth'),
    call('Grep', { pattern: 'login' }, 'a.ts:1'),
    call('Read', { file_path: '/a.ts' }, big),
    call('Edit', { file_path: '/a.ts' }),
    call('Bash', { command: 'npm test' }, '3 failed, 10 passed', true),
    prompt('Now also refresh tokens'),
    call('Write', { file_path: '/b.ts' }),
    call('Edit', { file_path: '/a.ts' }),
    call('Grep', { pattern: 'refresh' }, 'b.ts:1'),
  ])
  expect(scan.editedFiles).toBe(2)
  // The latest turn's search is still in use: one old search.
  expect(scan.oldSearch.count).toBe(1)
  expect(scan.dumps.count).toBe(1)
  expect(scan.failingTests).not.toBeNull()
  expect(scan.turns[0]!.readTokens).toBe(6_000)
  expect(scan.calls.Grep).toBe(2)
})

test('a passing test run clears the failure', async () => {
  const scan = scanSession([
    prompt('run the tests'),
    call('Bash', { command: 'bun test' }, '2 fail', true),
    call('Bash', { command: 'bun test' }, '12 pass\n0 fail'),
  ])
  expect(scan.failingTests).toBeNull()
})

test('planner chips, overrides and the instruction text', async () => {
  const scan = fixture('cloudy', 0).scan!
  const chips = plannerChips(scan, {})
  expect(chips.map(c => c.label)).toEqual([
    'Current task and plan',
    'Files edited (7)',
    'Decisions made',
    'Failing test output',
    'User preferences',
    'Old search results',
    'Large file dumps (4)',
  ])
  expect(compactInstructions(chips, scan)).toBe(
    'Keep the current task, plan, the 7 edited file paths and the decisions made. Drop raw search output and file dumps.',
  )
  const withTests = plannerChips(scan, { tests: true, dumps: false })
  expect(compactInstructions(withTests, scan)).toContain('the failing test output verbatim')
  expect(compactInstructions(withTests, scan)).not.toContain('file dumps')
  // Keeping test output verbatim costs its tokens after compaction.
  expect(estimateAfter(30_000, 90_000, withTests) - estimateAfter(30_000, 90_000, chips)).toBe(2_400)
})

test('next move fires only on its rule, three at most', async () => {
  const quiet = scanSession([prompt('hello there friend')])
  expect(nextMoves(quiet, 2_000, 60_000)).toEqual([])
  const busy = fixture('storm', 0).scan!
  const moves = nextMoves(busy, 9_300, 53_000)
  expect(moves.map(m => m.id)).toEqual(['explore', 'claude-md', 'new-session'])
  expect(moves[0]!.text).toBe('Your last 3 turns read 41k of files. Next broad search: hand it to an Explore subagent.')
  expect(moves[1]!.text).toBe('CLAUDE.md is 9.3k. Move rarely used sections into a skill to load them on demand.')
  expect(moves[2]!.text).toBe('The topic changed 6 turns ago. A new session would start at 66k.')
  expect(nextMoves(busy, 9_300, 53_000, 168_000)[2]!.text).toBe('The topic changed 6 turns ago. A new session would start at 66k, not 168k.')
})

test('topic shift: found when the new prompts share no words with the old', async () => {
  const t = (prompt: string) => ({ prompt, tokens: 1_000 })
  const shift = topicShift([
    t('fix login session cookie auth'),
    t('login redirect auth bug'),
    t('auth token refresh login'),
    t('session cookie expiry auth'),
    t('write quarterly marketing newsletter draft'),
    t('newsletter subject lines marketing'),
  ])
  expect(shift).toEqual({ turnsAgo: 2, tokens: 2_000 })
  expect(topicShift([t('auth login'), t('auth cookie'), t('auth refresh'), t('auth login session')])).toBeNull()
})

test('transcript reads: cache TTL and subagent peak', async () => {
  const line = (cc: Record<string, number>, side = false) =>
    JSON.stringify({ type: 'assistant', isSidechain: side, timestamp: '2026-11-08T01:40:59.631Z', message: { usage: { cache_creation: cc } } })
  expect(lastCacheTtl([line({ ephemeral_5m_input_tokens: 10 }), line({ ephemeral_1h_input_tokens: 5 })].join('\n'))?.ttlMs).toBe(3_600_000)
  expect(lastCacheTtl([line({ ephemeral_1h_input_tokens: 5 }), line({ ephemeral_5m_input_tokens: 10 })].join('\n'))?.ttlMs).toBe(300_000)
  expect(lastCacheTtl(line({ ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 }))).toBeNull()
  const usage = (i: number, r: number, w: number) => JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: i, cache_read_input_tokens: r, cache_creation_input_tokens: w } } })
  expect(subagentPeak([usage(2, 0, 52_506), usage(2, 52_506, 9_095)].join('\n'))).toBe(61_603)
})

test('every debug fixture builds a panel in its state', async () => {
  const now = Date.parse('2026-11-08T12:00:00Z')
  const clear = buildPanel(fixture('clear', now))!
  expect(clear.level.name).toBe('Clear')
  expect(clear.hero).toBe('19% to auto-compact')
  const cloudy = buildPanel(fixture('cloudy', now))!
  expect(cloudy.level.name).toBe('Cloudy')
  expect(cloudy.hero).toBe('~14 turns left')
  expect(cloudy.cache?.isWarm).toBe(true)
  expect(cloudy.mcpFlag?.name).toBe('figma')
  expect(cloudy.agents?.kept).toBe(84_000 - 1_200 + 61_000 - 800)
  expect(cloudy.planner?.best.text).toBe('Now · idle, cache warm')
  const storm = buildPanel(fixture('storm', now))!
  expect(storm.level.name).toBe('Storm')
  expect(storm.cache?.isWarm).toBe(false)
  expect(storm.moves.length).toBe(3)
})

test('cache countdown: minutes while there is time, seconds near the end', async () => {
  expect(cacheLeft(52 * 60_000 + 10_000)).toBe('52m')
  expect(cacheLeft(65 * 60_000)).toBe('1h 5m')
  expect(cacheLeft(4 * 60_000 + 5_000)).toBe('4:05')
  expect(cacheLeft(-1)).toBe('0:00')
})

test('a typed instruction is appended to the planned ones', async () => {
  const scan = fixture('cloudy', 0).scan!
  const chips = plannerChips(scan, {})
  expect(compactInstructions(chips, scan, 'Keep the API contract')).toMatch(/file dumps\. Keep the API contract\.$/)
  expect(compactInstructions(chips, scan, '  ')).toMatch(/file dumps\.$/)
})

test('band: one line, limits past 50% in a fixed order, actions by weather', async () => {
  const now = Date.parse('2026-11-08T12:00:00Z')
  const ends = (...t: number[]) => t.map((tokens, i) => ({ at: i, tokens, output: 0, isCompaction: false, isTurnEnd: true }))
  const reading = (limits: { kind: string; percentUsed: number; resetsAt?: string }[]) => ({
    window: 1_000_000, threshold: 800_000, limits, usd: 21.3, startedAt: 0, measuredAt: 0, categories: [],
  })
  const quiet = ends(400_000, 405_000, 410_000)
  const b = buildBand(forecast(quiet, reading([]))!, reading([]), quiet, now)
  expect(b.level.name).toBe('Cloudy')
  expect(b.text).toBe('~78 turns until auto-compact')
  expect(b.action).toBe('none')
  expect(b.figure).toBe('410k / 800k')
  // ~78 turns is still something to watch: the band stays up.
  expect(b.isCalm).toBe(false)
  const r = reading([
    { kind: 'seven_day', percentUsed: 62, resetsAt: new Date(now + 2 * 86_400_000).toISOString() },
    { kind: 'five_hour', percentUsed: 91, resetsAt: new Date(now + 74 * 60_000).toISOString() },
    { kind: 'seven_day_opus', percentUsed: 12 },
  ])
  const withLimits = buildBand(forecast(quiet, r)!, r, quiet, now)
  expect(withLimits.limits.map(l => l.text)).toEqual(['5h 91% · resets 1h 14m', '7d 62% · resets 2d'])
  // A limit near its end keeps the band up even when the context is calm.
  const easy = ends(100_000, 101_000, 102_000)
  expect(buildBand(forecast(easy, r)!, r, easy, now).isCalm).toBe(false)
  expect(buildBand(forecast(easy, reading([]))!, reading([]), easy, now).isCalm).toBe(true)
  const rain = ends(500_000, 530_000, 560_000)
  expect(buildBand(forecast(rain, r)!, r, rain, now).action).toBe('inline')
  const storm = ends(640_000, 680_000, 720_000)
  const s = buildBand(forecast(storm, r)!, r, storm, now)
  expect(s.action).toBe('row')
  expect(s.text).toBe('~2 turns until auto-compact')
  const compacted = markCompaction(storm, 85_000, 9)
  expect(buildBand(forecast(compacted, r)!, r, compacted, now).text).toBe('Compacted · 720k → 85k')
  const plenty = ends(100_000, 101_000, 102_000)
  // With room to spare the band says the share, so the sky has its reason.
  expect(buildBand(forecast(plenty, r)!, r, plenty, now).text).toBe('13% to auto-compact')
})

test('cache TTL from behaviour when the transcript cannot be read', async () => {
  const u = (read: number, write: number) => ({ input_tokens: 2, cache_read_input_tokens: read, cache_creation_input_tokens: write })
  const t0 = 1_000_000
  // Read from cache after 20 idle minutes: the entry outlived 5m, so 1h.
  expect(inferTtl(t0, t0 + 20 * 60_000, u(500_000, 600))).toBe(3_600_000)
  // Re-written after 20 idle minutes: it lapsed inside the hour, so 5m.
  expect(inferTtl(t0, t0 + 20 * 60_000, u(0, 500_000))).toBe(300_000)
  // Requests within five minutes say nothing; nor does a first request.
  expect(inferTtl(t0, t0 + 60_000, u(500_000, 600))).toBeNull()
  expect(inferTtl(null, t0, u(500_000, 600))).toBeNull()
  // Re-written after more than an hour: either lifetime would have lapsed.
  expect(inferTtl(t0, t0 + 2 * 3_600_000, u(0, 500_000))).toBeNull()
})

test('model names, app servers and day-long resets read plainly', async () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-sonnet-4-5-20250929[1m]')).toBe('Sonnet 4.5')
  expect(modelName('claude-haiku-5')).toBe('Haiku 5')
  expect(modelName('Opus 5.5')).toBe('Opus 5.5')
  expect(isAppServer('Claude_Browser')).toBe(true)
  expect(isAppServer('claude-in-chrome')).toBe(true)
  expect(isAppServer('figma')).toBe(false)
  expect(fmtIn((24 * 60 + 17) * 60_000)).toBe('1d 0h')
  expect(fmtIn((30 * 60 + 5) * 60_000)).toBe('1d 6h')
  expect(fmtIn(3 * 86_400_000)).toBe('3d')
})
