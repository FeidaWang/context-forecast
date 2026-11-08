// Pure readings of the session for the panel: the context grouped the way the
// panel lists it, MCP servers, the compact planner's chips and the "next move"
// rules. Everything here takes plain data, so the tests and the debug fixtures
// run the same code the live panel does.

import type { Chip, ContextGroup, GroupKey, McpServerRow, NextMove, SessionScan } from '../types'

// ≈ tokens of a text: the usual four characters a token.
export const tokensOf = (text: string | undefined) => Math.ceil((text?.length ?? 0) / 4)

// ---- the context, grouped -------------------------------------------------------

export const GROUP_LABEL: Record<GroupKey, string> = {
  system: 'System prompt and tools',
  memory: 'CLAUDE.md and memory',
  mcp: 'MCP tools',
  skills: 'Skills and agents',
  messages: 'Messages and tool results',
  other: 'Other',
}

// Category slots, fixed order; validated for contrast on both themes.
export const GROUP_COLOR: Record<GroupKey, string> = {
  system: '#7f77dd',
  memory: '#afa9ec',
  mcp: '#1d9e75',
  skills: '#5dcaa5',
  messages: '#3987e5',
  other: '#888780',
}
export const RESERVE_COLOR = '#888780'

const ORDER: GroupKey[] = ['system', 'memory', 'mcp', 'skills', 'messages', 'other']

export function groupOf(name: string): GroupKey {
  const n = name.toLowerCase()
  if (n.includes('mcp')) return 'mcp'
  if (n.startsWith('system')) return 'system'
  if (n.includes('memory') || n.includes('claude.md')) return 'memory'
  if (n.includes('skill') || n.includes('agent') || n.includes('command')) return 'skills'
  if (n.includes('message')) return 'messages'
  return 'other'
}

type Category = { name: string; tokens: number; kind: string }

// The used rows of /context's breakdown, folded into the panel's groups.
// Free space, the compaction buffer and deferred schemas are not "in context".
export function groupCategories(categories: readonly Category[]): ContextGroup[] {
  const sums = new Map<GroupKey, number>()
  for (const c of categories) {
    if (c.kind !== 'used' || c.tokens <= 0) continue
    const k = groupOf(c.name)
    sums.set(k, (sums.get(k) ?? 0) + c.tokens)
  }
  return ORDER.filter(k => (sums.get(k) ?? 0) > 0).map(k => ({ key: k, tokens: sums.get(k)! }))
}

// ---- MCP servers ------------------------------------------------------------------

// Server of a wire name `mcp__<server>__<tool>`.
export function serverOfTool(tool: string): string | null {
  if (!tool.startsWith('mcp__')) return null
  const rest = tool.slice(5)
  const cut = rest.lastIndexOf('__')
  return cut > 0 ? rest.slice(0, cut) : rest
}

type McpTool = { name: string; serverName: string; tokens: number; isLoaded: boolean }

// Schema tokens in the window per server, with the calls seen this session
// (wire names are mapped to servers through the breakdown's own tool list).
export function mcpServers(tools: readonly McpTool[], callsByTool: Readonly<Record<string, number>>): McpServerRow[] {
  const rows = new Map<string, McpServerRow>()
  const serverOf = new Map<string, string>()
  for (const t of tools) {
    serverOf.set(t.name, t.serverName)
    const row = rows.get(t.serverName) ?? { name: t.serverName, tokens: 0, calls: 0 }
    if (t.isLoaded) row.tokens += t.tokens
    rows.set(t.serverName, row)
  }
  for (const [tool, n] of Object.entries(callsByTool)) {
    const server = serverOf.get(tool) ?? serverOfTool(tool)
    if (!server) continue
    const row = rows.get(server) ?? { name: server, tokens: 0, calls: 0 }
    row.calls += n
    rows.set(server, row)
  }
  return [...rows.values()].sort((a, b) => b.tokens - a.tokens)
}

// A server worth disabling: big schemas in the window, never called.
export const MCP_FLAG_TOKENS = 5_000
export function idleHeavyServer(servers: readonly McpServerRow[]): McpServerRow | null {
  return servers.find(s => s.calls === 0 && s.tokens >= MCP_FLAG_TOKENS) ?? null
}

// ---- reading the conversation -------------------------------------------------------

type ToolUse = { tool: string; input: Record<string, unknown>; text?: string; isError?: true; agentId?: string }
export type Row = { role: 'user' | 'assistant'; text: string; toolUses: readonly ToolUse[]; toolResults?: readonly unknown[] }

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'WebSearch', 'WebFetch', 'LS'])
const TEST_COMMAND = /\b(test|tests|jest|vitest|pytest|mocha|rspec|go test|cargo test|bun test|npm t\b|plugin test)\b/i
const FAILURE = /(\b\d+\s+(fail|failed|failing|failures?)\b|\bFAIL\b|\bfailed\b|AssertionError|✗)/
const PASS_ONLY = /\b0\s+fail/i
export const DUMP_TOKENS = 5_000

const PREFERENCE = /\b(always|never|prefer|don't|do not|instead of|from now on)\b/i

const isPrompt = (r: Row) => r.role === 'user' && !(r.toolResults && r.toolResults.length > 0) && r.text.trim() !== '' && !r.text.trimStart().startsWith('<')

// One pass over the main conversation since the latest compaction (what
// `$.session.messages()` returns): what the planner and the rules read.
export function scanSession(rows: readonly Row[]): SessionScan {
  const turns: { prompt: string; readTokens: number; tokens: number }[] = []
  const edited = new Set<string>()
  const calls: Record<string, number> = {}
  let search = { count: 0, tokens: 0 }
  let dumps = { count: 0, tokens: 0 }
  let failing: { tokens: number } | null = null
  let messageTokens = 0
  let preferences = false
  // Searches in the latest turn are still in use: only older ones count as "old".
  let turnSearch = { count: 0, tokens: 0 }

  for (const r of rows) {
    const size = tokensOf(r.text) + r.toolUses.reduce((a, u) => a + tokensOf(u.text) + tokensOf(JSON.stringify(u.input)), 0)
    messageTokens += size
    if (isPrompt(r)) {
      search = { count: search.count + turnSearch.count, tokens: search.tokens + turnSearch.tokens }
      turnSearch = { count: 0, tokens: 0 }
      if (PREFERENCE.test(r.text)) preferences = true
      turns.push({ prompt: r.text, readTokens: 0, tokens: size })
      continue
    }
    const turn = turns[turns.length - 1]
    if (turn) turn.tokens += size
    for (const u of r.toolUses) {
      calls[u.tool] = (calls[u.tool] ?? 0) + 1
      const t = tokensOf(u.text)
      const path = typeof u.input.file_path === 'string' ? u.input.file_path : typeof u.input.notebook_path === 'string' ? u.input.notebook_path : null
      if (EDIT_TOOLS.has(u.tool) && path) edited.add(path)
      if (u.tool === 'Read' && turn) turn.readTokens += t
      if (SEARCH_TOOLS.has(u.tool)) turnSearch = { count: turnSearch.count + 1, tokens: turnSearch.tokens + t }
      if (t >= DUMP_TOKENS && (u.tool === 'Read' || u.tool === 'Bash')) dumps = { count: dumps.count + 1, tokens: dumps.tokens + t }
      if (u.tool === 'Bash' && TEST_COMMAND.test(String(u.input.command ?? ''))) {
        // The latest test run decides: a pass clears an earlier failure.
        const text = u.text ?? ''
        failing = (u.isError || FAILURE.test(text)) && !PASS_ONLY.test(text) ? { tokens: Math.min(t, 4_000) } : null
      }
    }
  }
  return {
    turns: turns.map(t => ({ readTokens: t.readTokens, tokens: t.tokens })),
    editedFiles: edited.size,
    oldSearch: search,
    dumps,
    failingTests: failing,
    calls,
    messageTokens,
    preferences,
    shift: topicShift(turns),
  }
}

// ---- topic shift ------------------------------------------------------------------

const STOP = new Set(
  'that this with from have what when where which there their about would could should into your them then than they will just like make some more also only been were does done want need please thanks okay using used here know very much each other after before while being these those over under again still'.split(' '),
)

export function keywords(text: string): Set<string> {
  const out = new Set<string>()
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? []) if (!STOP.has(w)) out.add(w)
  return out
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 1
  let shared = 0
  for (const w of a) if (b.has(w)) shared += 1
  return shared / Math.min(a.size, b.size)
}

// The turn where the conversation moved on: the earliest split (at least three
// prompts before it, at most eight after) where the prompts after share under
// 10% of their words with the prompts before. `turnsAgo` counts the prompts
// since; `tokens` is what those turns hold, the start of a fresh session.
export function topicShift(turns: readonly { prompt: string; tokens: number }[]): { turnsAgo: number; tokens: number } | null {
  for (let k = Math.max(3, turns.length - 8); k < turns.length; k += 1) {
    const before = new Set<string>()
    const after = new Set<string>()
    turns.slice(0, k).forEach(t => keywords(t.prompt).forEach(w => before.add(w)))
    turns.slice(k).forEach(t => keywords(t.prompt).forEach(w => after.add(w)))
    if (after.size >= 3 && overlap(after, before) < 0.1) {
      return { turnsAgo: turns.length - k, tokens: turns.slice(k).reduce((a, t) => a + t.tokens, 0) }
    }
  }
  return null
}

// ---- compact planner ------------------------------------------------------------------

// The chips, derived from the scan; `overrides` holds what the person toggled.
export function plannerChips(scan: SessionScan, overrides: Readonly<Record<string, boolean>>): Chip[] {
  const chips: Chip[] = [
    { id: 'task', side: 'keep', label: 'Current task and plan', on: true, tokens: 0 },
  ]
  if (scan.editedFiles > 0) chips.push({ id: 'files', side: 'keep', label: `Files edited (${scan.editedFiles})`, on: true, tokens: 0 })
  chips.push({ id: 'decisions', side: 'keep', label: 'Decisions made', on: true, tokens: 0 })
  if (scan.failingTests) chips.push({ id: 'tests', side: 'keep', label: 'Failing test output', on: false, tokens: scan.failingTests.tokens })
  if (scan.preferences) chips.push({ id: 'prefs', side: 'keep', label: 'User preferences', on: false, tokens: 0 })
  if (scan.oldSearch.count > 0) chips.push({ id: 'search', side: 'drop', label: 'Old search results', on: true, tokens: scan.oldSearch.tokens })
  if (scan.dumps.count > 0) chips.push({ id: 'dumps', side: 'drop', label: `Large file dumps (${scan.dumps.count})`, on: true, tokens: scan.dumps.tokens })
  return chips.map(c => (c.id in overrides ? { ...c, on: overrides[c.id]! } : c))
}

function list(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

// The /compact instructions the chips say.
export function compactInstructions(chips: readonly Chip[], scan: SessionScan, extra = ''): string {
  const on = new Set(chips.filter(c => c.on).map(c => c.id))
  const keep: string[] = []
  if (on.has('task')) keep.push('the current task, plan')
  if (on.has('files')) keep.push(`the ${scan.editedFiles} edited file path${scan.editedFiles === 1 ? '' : 's'}`)
  if (on.has('decisions')) keep.push('the decisions made')
  if (on.has('tests')) keep.push('the failing test output verbatim')
  if (on.has('prefs')) keep.push("the user's stated preferences")
  const drop: string[] = []
  if (on.has('search')) drop.push('raw search output')
  if (on.has('dumps')) drop.push('file dumps')
  const out: string[] = []
  if (keep.length > 0) out.push(`Keep ${list(keep)}.`)
  if (drop.length > 0) out.push(`Drop ${list(drop)}.`)
  const typed = extra.trim()
  if (typed) out.push(/[.!?]$/.test(typed) ? typed : `${typed}.`)
  return out.join(' ') || 'Summarize the conversation.'
}

export function compactCommand(instructions: string): string {
  return `/compact ${instructions}`
}

// ≈ the context after compacting: what stays outside the messages, plus a
// summary of about a tenth of the messages (3k to 20k), plus anything kept
// verbatim.
export function estimateAfter(overhead: number, messages: number, chips: readonly Chip[]): number {
  const summary = Math.min(20_000, Math.max(3_000, Math.round(messages * 0.1)))
  const verbatim = chips.filter(c => c.on && c.side === 'keep').reduce((a, c) => a + c.tokens, 0)
  return overhead + summary + verbatim
}

// ---- next move ------------------------------------------------------------------

export const READ_HEAVY = 30_000
export const CLAUDE_MD_HEAVY = 8_000

// At most three, each only when its rule fires.
export function nextMoves(scan: SessionScan, claudeMdTokens: number, overhead: number, current = 0): NextMove[] {
  const moves: NextMove[] = []
  const recent = scan.turns.slice(-3)
  const read = recent.reduce((a, t) => a + t.readTokens, 0)
  if (recent.length > 0 && read > READ_HEAVY) {
    moves.push({
      id: 'explore',
      text: `Your last ${recent.length} turn${recent.length === 1 ? '' : 's'} read ${fmtKs(read)} of files. Next broad search: hand it to an Explore subagent.`,
    })
  }
  if (claudeMdTokens > CLAUDE_MD_HEAVY) {
    moves.push({
      id: 'claude-md',
      text: `CLAUDE.md is ${fmtKs(claudeMdTokens)}. Move rarely used sections into a skill to load them on demand.`,
    })
  }
  if (scan.shift) {
    const start = overhead + scan.shift.tokens
    moves.push({
      id: 'new-session',
      text: `The topic changed ${scan.shift.turnsAgo} turn${scan.shift.turnsAgo === 1 ? '' : 's'} ago. A new session would start at ${fmtKs(start)}${current > start ? `, not ${fmtKs(current)}` : ''}.`,
    })
  }
  return moves.slice(0, 3)
}

// ---- numbers ------------------------------------------------------------------

const GROUPED = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

// k values carry one decimal and thousands separators: 28.4k, 1,000.0k.
export function fmtK(n: number): string {
  if (Math.abs(n) < 1000) return WHOLE.format(Math.round(n))
  return `${GROUPED.format(n / 1000)}k`
}

// Always in k with one decimal (0.8k): a subagent's hand-back.
export function fmtK1(n: number): string {
  return `${GROUPED.format(n / 1000)}k`
}

// Summary figures: whole k from 10k up (168k, 430k), one decimal below (9.3k).
export function fmtKs(n: number): string {
  if (Math.abs(n) < 10_000) return fmtK(n)
  return `${WHOLE.format(Math.round(n / 1000))}k`
}

export function fmtInt(n: number): string {
  return WHOLE.format(Math.round(n))
}
