import type { WeatherSample } from '../types'

type Entry = {
  type?: string
  subtype?: string
  isSidechain?: boolean
  isMeta?: boolean
  requestId?: string
  timestamp?: string
  message?: {
    content?: unknown
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
}

function isPrompt(entry: Entry): boolean {
  if (entry.type !== 'user' || entry.isMeta || entry.isSidechain) return false
  const content = entry.message?.content
  if (typeof content === 'string') return true
  return Array.isArray(content) && !content.some(b => (b as { type?: string })?.type === 'tool_result')
}

// Rebuilds the context history from a session transcript (JSONL): one sample
// per main-thread model request, the last before each prompt marked a turn's
// end, the first after a compaction boundary marked as the compaction.
export function parseTranscript(text: string): WeatherSample[] {
  const out: WeatherSample[] = []
  const seen = new Set<string>()
  let isAfterCompaction = false
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue
    let entry: Entry
    try {
      entry = JSON.parse(line) as Entry
    } catch {
      continue
    }
    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      isAfterCompaction = true
      continue
    }
    if (isPrompt(entry)) {
      const last = out[out.length - 1]
      if (last) last.isTurnEnd = true
      continue
    }
    const u = entry.message?.usage
    if (entry.type !== 'assistant' || entry.isSidechain || !u) continue
    const id = entry.requestId ?? ''
    if (id && seen.has(id)) continue
    if (id) seen.add(id)
    const tokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
    if (tokens <= 0) continue
    const prev = out[out.length - 1]
    out.push({
      at: entry.timestamp ? Date.parse(entry.timestamp) || 0 : 0,
      tokens,
      output: u.output_tokens ?? 0,
      isCompaction: isAfterCompaction || (prev !== undefined && tokens < prev.tokens * 0.7),
      isTurnEnd: false,
    })
    isAfterCompaction = false
  }
  return out.slice(-400)
}

// Where Claude Code keeps a session's transcript.
export function transcriptPath(configDir: string, cwd: string, sessionId: string): string {
  return `${configDir}/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}/${sessionId}.jsonl`
}

// The cache lifetime the latest main-thread write used, read off the
// transcript's `usage.cache_creation` split (1h vs 5m writes), with when that
// response came back. Null when no response wrote to the cache.
export function lastCacheTtl(text: string): { ttlMs: number; at: number } | null {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!
    if (!line.includes('"cache_creation"') || !line.startsWith('{')) continue
    let entry: { type?: string; isSidechain?: boolean; timestamp?: string; message?: { usage?: { cache_creation?: Record<string, number> } } }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type !== 'assistant' || entry.isSidechain) continue
    const cc = entry.message?.usage?.cache_creation
    if (!cc) continue
    const at = entry.timestamp ? Date.parse(entry.timestamp) || 0 : 0
    if ((cc.ephemeral_1h_input_tokens ?? 0) > 0) return { ttlMs: 3_600_000, at }
    if ((cc.ephemeral_5m_input_tokens ?? 0) > 0) return { ttlMs: 300_000, at }
  }
  return null
}

// A subagent's own transcript: the largest request's input side, the context
// it worked in.
export function subagentPeak(text: string): number {
  let peak = 0
  for (const line of text.split('\n')) {
    if (!line.startsWith('{') || !line.includes('"usage"')) continue
    try {
      const u = (JSON.parse(line) as { type?: string; message?: { usage?: Record<string, number> } }).message?.usage
      if (!u) continue
      peak = Math.max(peak, (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0))
    } catch {
      // A torn line: skip it.
    }
  }
  return peak
}

// The cache lifetime as its behaviour shows it, for when the transcript cannot
// be read: after an idle gap past five minutes a request that still reads most
// of its prompt from the cache had a 1h lifetime; one inside the hour that
// reads almost nothing had 5m. Null while nothing tells.
export function inferTtl(
  lastAt: number | null,
  at: number,
  u: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number },
): number | null {
  if (lastAt === null) return null
  const gap = at - lastAt
  const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  if (gap <= 5 * 60_000 || total <= 0) return null
  const readShare = u.cache_read_input_tokens / total
  if (readShare >= 0.5) return 3_600_000
  if (gap < 3_600_000 && readShare < 0.1) return 300_000
  return null
}
