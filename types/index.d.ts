// One reading of the context: a model request's input side (`tokens`) and
// what it wrote (`output`). `isTurnEnd` marks the last request of a turn.
export type WeatherSample = {
  at: number
  tokens: number
  output: number
  isCompaction: boolean
  isTurnEnd: boolean
}

export type WeatherLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type WeatherCategory = { name: string; tokens: number }

export type GroupKey = 'system' | 'memory' | 'mcp' | 'skills' | 'messages' | 'other'

// One row of "What's in context": /context's used categories, folded.
export type ContextGroup = { key: GroupKey; tokens: number }

// One MCP server: its schema tokens in the window and the calls seen.
export type McpServerRow = { name: string; tokens: number; calls: number }

export type WeatherReading = {
  window: number
  threshold: number | null
  limits: WeatherLimit[]
  usd: number | null
  startedAt: number
  measuredAt: number
  categories: WeatherCategory[]
  // Added in 0.2.0; absent in a reading an older version stored.
  model?: string
  // The window /context measures against (the bar's full length) and the
  // compaction reserve at its end.
  barMax?: number
  reserve?: number
  groups?: ContextGroup[]
  mcpTools?: { name: string; serverName: string; tokens: number; isLoaded: boolean }[]
  claudeMdTokens?: number
}

// How the band above the prompt shows: both rows, one compact row, or not at all.
export type BandMode = 'full' | 'compact' | 'hidden'

export type WeatherTurn = { input: number; output: number; cacheRead: number; cacheWrite: number }

// The prompt cache as the last main-thread request left it.
export type CacheState = {
  // When the last main-thread request answered (clock ms).
  lastRequestAt: number
  // The cache lifetime the last write used, from the transcript's
  // `cache_creation.ephemeral_1h/5m_input_tokens`; null until one is seen.
  ttlMs: number | null
  read: number
  write: number
  input: number
}

// One subagent run, as seen by this mod.
export type AgentRun = {
  id: string
  type: string
  description: string
  // Its largest request's input side: the context it worked in.
  input: number
  // ≈ tokens of the answer handed back to the main context; null while it runs.
  returned: number | null
  isRunning: boolean
}

// What the planner and the next-move rules read off the conversation.
export type SessionScan = {
  turns: { readTokens: number; tokens: number }[]
  // How many files were edited (paths are not kept).
  editedFiles: number
  oldSearch: { count: number; tokens: number }
  dumps: { count: number; tokens: number }
  failingTests: { tokens: number } | null
  calls: Record<string, number>
  messageTokens: number
  // A prompt stated a standing preference ("always", "never", "prefer" ...).
  preferences?: boolean
  shift: { turnsAgo: number; tokens: number } | null
}

export type Chip = { id: string; side: 'keep' | 'drop'; label: string; on: boolean; tokens: number }

export type NextMove = { id: string; text: string }

export type PaneView = 'main' | 'planner'

// The debug preview: null shows live data.
export type DebugState = 'clear' | 'cloudy' | 'storm' | 'planner' | null

declare module 'claude-code' {
  interface PluginState {
    'context-forecast': {
      samples: WeatherSample[]
      reading: WeatherReading | null
      lastTurn: WeatherTurn | null
      bandMode: BandMode
      lastLevel: number
      cache: CacheState | null
      agents: AgentRun[]
      scan: SessionScan | null
      chipOverrides: Record<string, boolean>
      view: PaneView
      isDebugOn: boolean
      debug: DebugState
      isTurnRunning: boolean
      mcpCalls: Record<string, number>
      // The first press of Compact now arms it; the second compacts.
      isConfirming: boolean
      // An instruction the person typed, appended to the planned ones.
      extraInstruction: string
    }
  }
}
