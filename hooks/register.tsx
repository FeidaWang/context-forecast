import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, SessionCompactResult } from 'claude-code'

import type { AgentRun, BandMode, DebugState, WeatherReading, WeatherTurn } from '../types'
import {
  addRequest,
  endTurn,
  fmtIn,
  fmtCount,
  fmtUsd,
  forecast,
  gaugeCells,
  gaugeSvg,
  BAD,
  isAlertRank,
  limitName,
  markCompaction,
  PX_PER_CELL,
  turnsPhrase,
} from './forecast'
import type { Forecast, Level } from './forecast'
import { SKY_COLUMNS, skyCells, skySvg } from './sky'
import { lastCacheTtl, parseTranscript, subagentPeak } from './history'
import { inferTtl } from './history'
import { groupCategories, compactCommand, scanSession, serverOfTool, tokensOf } from './insights'
import { buildPanel } from './panel'
import type { PanelInput } from './panel'
import { fixture } from './fixtures'
import { PLANNER_FOCUS, cacheLeft, drawPane } from './pane'
import { buildBand } from './band'

const PANE = 'context-forecast'
const TITLE = 'Context Forecast'

const samples = atom({ plugin: 'context-forecast', key: 'samples' } as const, [])
const reading = atom({ plugin: 'context-forecast', key: 'reading' } as const, null)
const lastTurn = atom({ plugin: 'context-forecast', key: 'lastTurn' } as const, null)
const bandMode = atom({ plugin: 'context-forecast', key: 'bandMode' } as const, 'auto' as BandMode)
const lastLevel = atom({ plugin: 'context-forecast', key: 'lastLevel' } as const, -1)
const cacheAtom = atom({ plugin: 'context-forecast', key: 'cache' } as const, null)
const agentsAtom = atom({ plugin: 'context-forecast', key: 'agents' } as const, [] as AgentRun[])
const scanAtom = atom({ plugin: 'context-forecast', key: 'scan' } as const, null)
const overridesAtom = atom({ plugin: 'context-forecast', key: 'chipOverrides' } as const, {} as Record<string, boolean>)
const viewAtom = atom({ plugin: 'context-forecast', key: 'view' } as const, 'main' as 'main' | 'planner')
const debugOnAtom = atom({ plugin: 'context-forecast', key: 'isDebugOn' } as const, false)
const debugAtom = atom({ plugin: 'context-forecast', key: 'debug' } as const, null as DebugState)
const confirmAtom = atom({ plugin: 'context-forecast', key: 'isConfirming' } as const, false)
const extraAtom = atom({ plugin: 'context-forecast', key: 'extraInstruction' } as const, '')
const transcriptAtom = atom({ plugin: 'context-forecast', key: 'transcriptPath' } as const, null as string | null)
// The name `/weather` registered under (another plugin may hold `weather`).
let commandName = 'weather'
const runningAtom = atom({ plugin: 'context-forecast', key: 'isTurnRunning' } as const, false)
const mcpCallsAtom = atom({ plugin: 'context-forecast', key: 'mcpCalls' } as const, {} as Record<string, number>)

type Api = EngineInterface

// The terminal band's sky is repainted from a timer: where it is mounted and
// what it shows, as of its last drawing.
const sky: { site: string | null; level: Level | null; frame: number } = { site: null, level: null, frame: 0 }

async function tickSky($: Api): Promise<void> {
  try {
    await animateSky($)
  } catch {
    // A missed frame is harmless: the next tick repaints.
  }
}

async function animateSky($: Api): Promise<void> {
  if (!sky.site || !sky.level) return
  sky.frame += 1
  const r = await $.ui.blit({ requestId: sky.site, key: 'sky', cells: skyCells(sky.level, sky.frame) })
  if (r.deny) sky.site = null
}

// ---- gathering ------------------------------------------------------------------

// Where this session's transcript is, or null: the path Claude Code hands its
// own hooks (`transcript_path`), kept when one of them runs. No environment
// variable is read to work it out.
async function findTranscript($: Api): Promise<string | null> {
  const path = await read($, transcriptAtom)
  return path && (await $.fs.exists(path)) ? path : null
}

// Keeps the transcript path the first time a classic hook carries it, and
// builds the history from it then.
async function noteTranscript($: Api, path: string | undefined): Promise<void> {
  if (!path) return
  const known = await read($, transcriptAtom)
  if (known === path) return
  await update($, transcriptAtom, () => path)
  await backfill($)
}

// Rebuilds the history from this session's transcript, so a resumed session or
// a reload starts with its whole past instead of one point.
async function backfill($: Api): Promise<void> {
  try {
    const path = await findTranscript($)
    if (!path) return
    // Subagent records are small files of their own: read them whatever
    // becomes of the transcript.
    await backfillAgents($, path.replace(/\.jsonl$/, '/subagents')).catch(() => undefined)
    // A transcript over the 4 MiB read bound throws; the forecast then builds
    // from live readings instead of the past.
    const text = await $.fs.read(path)
    const history = parseTranscript(text)
    if (history.length > 0) await update($, samples, () => history)
    await readTtl($, text)
  } catch {
    // No history to be had: the forecast builds from live readings instead.
  }
}

// The cache lifetime in effect, from the transcript's last cache write.
async function readTtl($: Api, text?: string): Promise<void> {
  try {
    if (text === undefined) {
      const path = await findTranscript($)
      if (!path) return
      text = await $.fs.read(path)
    }
    const ttl = lastCacheTtl(text)
    if (!ttl) return
    await update($, cacheAtom, c => (c ? { ...c, ttlMs: ttl.ttlMs } : { lastRequestAt: ttl.at, ttlMs: ttl.ttlMs, read: 0, write: 0, input: 0 }))
  } catch {
    // Over the read bound: the TTL stays as last seen.
  }
}

// Subagents that ran before the mod loaded: `subagents/agent-<id>.meta.json`
// names the type, its `.jsonl` holds each request's usage.
async function backfillAgents($: Api, dir: string): Promise<void> {
  if (!(await $.fs.exists(dir))) return
  const known = new Set((await read($, agentsAtom)).map(a => a.id))
  const found: AgentRun[] = []
  for (const entry of await $.fs.list(dir)) {
    const m = /^agent-(.+)\.meta\.json$/.exec(entry.name)
    if (!m || known.has(m[1]!)) continue
    try {
      const meta = JSON.parse(await $.fs.read(`${dir}/${entry.name}`)) as { agentType?: string; description?: string; finished?: boolean }
      const log = `${dir}/agent-${m[1]}.jsonl`
      const input = (await $.fs.exists(log)) ? subagentPeak(await $.fs.read(log)) : 0
      found.push({ id: m[1]!, type: meta.agentType ?? 'agent', description: meta.description ?? '', input, returned: null, isRunning: meta.finished === false })
    } catch {
      // An unreadable record: leave that agent out.
    }
  }
  if (found.length > 0) await update($, agentsAtom, list => [...list, ...found])
}

// The conversation since the latest compaction, read for the planner, the
// next-move rules, MCP calls and what each subagent handed back.
async function rescan($: Api): Promise<void> {
  try {
    const rows = await $.session.messages()
    if (!Array.isArray(rows)) return
    const scan = scanSession(rows as never)
    await update($, scanAtom, () => scan)
    const returned = new Map<string, number>()
    for (const r of rows as { toolUses?: { tool: string; agentId?: string; text?: string }[] }[]) {
      for (const u of r.toolUses ?? []) if (u.agentId && u.text !== undefined) returned.set(u.agentId, tokensOf(u.text))
    }
    await update($, agentsAtom, list => list.map(a => (a.returned === null && returned.has(a.id) && !a.isRunning ? { ...a, returned: returned.get(a.id)! } : a)))
  } catch {
    // No messages to read (a test, a -p run): the planner waits.
  }
}

async function noteAgent($: Api, id: string, patch: (a: AgentRun) => AgentRun): Promise<void> {
  const list = await read($, agentsAtom)
  if (!list.some(a => a.id === id)) {
    const info = (await $.agent.list()).find(a => a.id === id)
    const fresh: AgentRun = { id, type: info?.type ?? 'agent', description: info?.description ?? '', input: 0, returned: null, isRunning: true }
    await update($, agentsAtom, l => [...l, patch(fresh)].slice(-12))
    return
  }
  await update($, agentsAtom, l => l.map(a => (a.id === id ? patch(a) : a)))
}

// Reads the session's figures (and the local /context estimate for the
// auto-compact point and the biggest categories) into state.
async function measure($: Api, isTurnEnd: boolean): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  const next: WeatherReading = {
    window: usage.context.window,
    threshold: b?.isAutoCompactEnabled && b.autoCompactThreshold ? b.autoCompactThreshold : null,
    limits: usage.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
    usd: usage.cost?.usd ?? null,
    startedAt: usage.startedAt,
    measuredAt: await $.clock.now(),
    categories: (b?.categories ?? [])
      .filter(c => c.kind === 'used' && c.tokens > 0)
      .sort((x, y) => y.tokens - x.tokens)
      .slice(0, 6)
      .map(c => ({ name: c.name, tokens: c.tokens })),
    model: b?.model,
    barMax: b?.rawMaxTokens,
    reserve: (b?.categories ?? []).filter(c => c.kind === 'buffer').reduce((a, c) => a + c.tokens, 0),
    groups: groupCategories(b?.categories ?? []),
    mcpTools: (b?.mcpTools ?? []).map(t => ({ name: t.name, serverName: t.serverName, tokens: t.tokens, isLoaded: t.isLoaded })),
    claudeMdTokens: (b?.memoryFiles ?? []).filter(m => /CLAUDE(\.local)?\.md$/i.test(m.path)).reduce((a, m) => a + m.tokens, 0),
  }
  await update($, reading, () => next)
  const tokens = usage.context.tokens
  if (isTurnEnd && tokens !== undefined) {
    const at = await $.clock.now()
    await update($, samples, list => endTurn(list, tokens, at))
  }
  await afterMeasure($)
}

async function afterMeasure($: Api): Promise<void> {
  const f = forecast(await read($, samples), await read($, reading))
  if (!f) return
  const before = await read($, lastLevel)
  const rank = f.level.rank
  await update($, lastLevel, () => rank)
  if (isAlertRank(rank) && rank > before && before !== -1) {
    const turns = turnsPhrase(f)
    $.ui.toast(`${f.level.icon} ${f.level.name} warning: context ${f.windowPercent}%${turns ? `, ${turns}` : ''}`, {
      timeoutMs: 8000,
    })
  }
}

async function setBandMode($: Api, mode: BandMode): Promise<void> {
  await update($, bandMode, () => mode)
  if (mode === 'hidden') $.ui.toast(`Context Forecast hidden · /${commandName} brings it back`, { timeoutMs: 8000 })
  if (mode === 'compact') $.ui.toast(`Weather moved to the footer · /${commandName} brings the band back`, { timeoutMs: 6000 })
}

// Opens the forecast pane on its planner, from the band's button.
async function planFromBand($: Api): Promise<void> {
  if (!(await $.ui.panes()).some(p => p.id === PANE)) await $.ui.open({ id: PANE, title: TITLE })
  await openPlanner($)
}

// A compaction that stood: the forecast restarts from what it left, and the
// planner forgets the conversation it planned for.
async function afterCompaction($: Api, ran: SessionCompactResult): Promise<void> {
  if (ran.skip !== undefined) return
  const at = await $.clock.now()
  const after = ran.tokensAfter
  if (after !== undefined) await update($, samples, list => markCompaction(list, after, at))
  await update($, overridesAtom, () => ({}))
  await update($, scanAtom, () => null)
}

// What the pane draws: live state, or a fixture while a debug preview is on.
async function panelInput($: Api): Promise<PanelInput> {
  const now = await $.clock.now()
  const debug = await read($, debugAtom)
  if (debug) return { ...fixture(debug, now), overrides: await read($, overridesAtom), extra: await read($, extraAtom) }
  return {
    samples: await read($, samples),
    reading: await read($, reading),
    turn: await read($, lastTurn),
    cache: await read($, cacheAtom),
    agents: await read($, agentsAtom),
    scan: await read($, scanAtom),
    mcpCalls: await read($, mcpCallsAtom),
    overrides: await read($, overridesAtom),
    extra: await read($, extraAtom),
    isTurnRunning: await read($, runningAtom),
    now,
  }
}

async function plannedInstructions($: Api): Promise<string | null> {
  const p = buildPanel(await panelInput($))
  return p?.planner?.instructions ?? null
}

async function copyCommand($: Api, surface: string): Promise<void> {
  const text = await plannedInstructions($)
  if (text === null) return
  const r = await $.ui.copy({ text: compactCommand(text), surface: surface as never })
  $.ui.toast(r.isCopied ? 'Copied /compact command' : `Could not copy: ${r.reason ?? 'no clipboard'}`)
}

async function compactNow($: Api): Promise<void> {
  if (await read($, runningAtom)) {
    $.ui.toast('A turn is running: compact when it ends, or copy the command')
    return
  }
  // The first press arms; the second compacts. Compaction cannot be undone.
  if (!(await read($, confirmAtom))) {
    await update($, confirmAtom, () => true)
    return
  }
  await update($, confirmAtom, () => false)
  if (await read($, debugAtom)) {
    $.ui.toast('Preview only: switch the preview to Live to compact')
    return
  }
  const instructions = await plannedInstructions($)
  if (instructions === null) return
  try {
    // The engine skips this plugin's own session.compact hook for a call it
    // made, so the forecast restarts here.
    const r = await $.session.compact({ instructions })
    if (r.skip !== undefined) $.ui.toast(`Compaction skipped: ${r.skip}`)
    else {
      await afterCompaction($, r)
      await update($, extraAtom, () => '')
      await update($, viewAtom, () => 'main')
    }
  } catch {
    // Where the session runs headless (the desktop app, an SDK host) the call
    // is not there yet: compaction runs as a turn of its own. Run `/compact`
    // as the person would; its session.compact reaches our hook as any
    // compaction does, and the forecast restarts there.
    try {
      await $.command.run({ command: 'compact', args: instructions })
      $.ui.toast('Compacting with your plan…', { timeoutMs: 4000 })
      await update($, extraAtom, () => '')
      await update($, viewAtom, () => 'main')
    } catch (err) {
      await copyCommand($, 'desktop')
      $.ui.toast(`Could not start /compact here (${(err as Error).message}). The command is on your clipboard: paste it and send.`, { timeoutMs: 10000 })
    }
  }
}

async function togglePane($: Api): Promise<string> {
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  if (isOpen) {
    await $.ui.close({ id: PANE })
    return 'Forecast closed.'
  }
  await $.ui.open({ id: PANE, title: TITLE })
  return 'Forecast opened.'
}

// The command, under whichever name it registered.
async function weatherCommand($: Api, args: string): Promise<{ text: string }> {
  const arg = args.trim().toLowerCase()
  const preset = /^debug\s+(live|clear|cloudy|storm|planner)$/.exec(arg)
  if (preset) {
    // `/weather debug <state>` jumps straight to a preview.
    const state = preset[1] === 'live' ? null : (preset[1] as DebugState)
    await update($, debugOnAtom, () => true)
    await update($, debugAtom, () => state)
    if (!(await $.ui.panes()).some(p => p.id === PANE)) await $.ui.open({ id: PANE, title: TITLE })
    return { text: `Previewing ${preset[1]}.` }
  }
  if (arg === 'debug') {
    const isOn = !(await read($, debugOnAtom))
    await update($, debugOnAtom, () => isOn)
    if (!isOn) await update($, debugAtom, () => null)
    if (isOn && !(await $.ui.panes()).some(p => p.id === PANE)) await $.ui.open({ id: PANE, title: TITLE })
    return { text: isOn ? 'Debug preview on: pick a state at the top of the forecast.' : 'Debug preview off.' }
  }
  if (arg === 'forecast') {
    await measure($, false)
    return { text: await togglePane($) }
  }
  if (arg === 'hide') {
    await setBandMode($, 'hidden')
    return { text: 'Context Forecast hidden.' }
  }
  if (arg === 'auto') {
    await setBandMode($, 'auto')
    return { text: 'Context Forecast band: auto (in the footer while there is room, above the prompt when it matters).' }
  }
  if (arg === 'mini') {
    await setBandMode($, 'compact')
    return { text: 'Context Forecast minimized to the footer.' }
  }
  // Bare /weather brings the band back, whatever state it was in.
  await measure($, false)
  await setBandMode($, 'full')
  return { text: 'Context Forecast band shown.' }
}

export function register(on: Parameters<Register>[0]): void {
  on('session.start', async ($, e, next) => {
    // `/weather` is the name; where another plugin (the original token-weather
    // sample) holds it, the same command answers as `/context-forecast`
    // (`/forecast` is taken by the sales plugin's skill).
    for (const name of ['weather', 'context-forecast']) {
      try {
        await $.command.register({
          name,
          description: 'Context Forecast: show the band; `forecast` opens the forecast, `mini` minimizes, `hide` hides, `debug` previews',
          argumentHint: '[forecast|auto|mini|hide|debug]',
          immediate: true,
        })
        commandName = name
        break
      } catch {
        // Taken: try the next name.
      }
    }
    const ran = await next(e)
    $.ui.status(undefined)
    $.clock.every(450, () => tickSky($))
    // The cache countdown ticks once a second while the pane shows it.
    $.clock.every(1000, () => void tickPane($))
    await update($, runningAtom, () => false)
    await backfill($)
    await measure($, true)
    await rescan($)
    return ran
  })

  // Every main-thread model request is a reading: the band moves while a long
  // turn runs, not only when it ends. A subagent's requests size its context.
  on('turn.step', async function* ($, e, next) {
    const ran = yield* next(e)
    const u = ran.usage
    if (!u) return ran
    const tokens = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
    const at = await $.clock.now()
    if (e.agentId === undefined) {
      await update($, samples, list => addRequest(list, tokens, u.output_tokens, at))
      // Where the transcript cannot say (over the read bound), the cache's own
      // behaviour across an idle gap tells its lifetime (inferTtl).
      await update($, cacheAtom, c => ({
        lastRequestAt: at,
        ttlMs: c?.ttlMs ?? inferTtl(c?.lastRequestAt ?? null, at, u),
        read: u.cache_read_input_tokens,
        write: u.cache_creation_input_tokens,
        input: u.input_tokens,
      }))
    } else {
      await noteAgent($, e.agentId, a => ({ ...a, input: Math.max(a.input, tokens), isRunning: true }))
    }
    return ran
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await update($, runningAtom, () => true)
    return next(e)
  })

  // MCP calls, counted as they happen (the conversation may lose them to a
  // compaction).
  on('tool.call', async ($, e, next) => {
    if (serverOfTool(e.tool) !== null) await update($, mcpCallsAtom, c => ({ ...c, [e.tool]: (c[e.tool] ?? 0) + 1 }))
    return next(e)
  })

  // Claude Code hands every classic hook the session's transcript path; these
  // three only note it and pass the event on unchanged.
  on('classic.SessionStart', async ($, e, next) => {
    await noteTranscript($, e.transcript_path)
    return next(e)
  })
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteTranscript($, e.transcript_path)
    return next(e)
  })
  on('classic.Stop', async ($, e, next) => {
    await noteTranscript($, e.transcript_path)
    return next(e)
  })

  // A compaction restarts the forecast from what it left: the hook only
  // watches (after `next`) and passes the compaction through unchanged.
  on('session.compact', async ($, e, next) => {
    const ran = await next(e)
    if (e.trigger !== 'precompute' && e.agentId === undefined) await afterCompaction($, ran)
    return ran
  })

  on('session.measure', async ($, e, next) => {
    const ran = await next(e)
    await measure($, e.changed.includes('context'))
    return ran
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, samples, () => [])
      await update($, lastTurn, () => null)
      await update($, lastLevel, () => -1)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined) {
      // A subagent's answer is what it hands back to the main context.
      const returned = tokensOf(e.answer)
      await noteAgent($, e.agentId, a => ({ ...a, returned, isRunning: false }))
      return ran
    }
    await update($, runningAtom, () => false)
    if (e.usage) {
      const u = e.usage
      const turn: WeatherTurn = {
        input: u.input_tokens,
        output: u.output_tokens,
        cacheRead: u.cache_read_input_tokens,
        cacheWrite: u.cache_creation_input_tokens,
      }
      await update($, lastTurn, () => turn)
    }
    await readTtl($)
    await rescan($)
    return ran
  })

  on('command.run', { command: 'context-forecast' }, ($, e) => weatherCommand($, e.args))
  on('command.run', { command: 'weather' }, ($, e) => weatherCommand($, e.args))
  // ---- the band above the prompt ----------------------------------------------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const mode = await read($, bandMode)
    if (e.props.hasSurvey || e.props.view.agentId !== undefined || (mode !== 'full' && mode !== 'auto')) {
      return next(e)
    }
    const r = await read($, reading)
    const list = await read($, samples)
    const f = forecast(list, r)
    // Auto: nothing to act on, so the weather waits in the footer.
    if (mode === 'auto' && f && r && buildBand(f, r, list, await $.clock.now()).isCalm) return next(e)
    const isTerminal = e.surface === 'terminal'
    const cols = e.props.bodyColumns
    const { Box, Text, Button } = $.ui.resolve(e)
    const controls = (
      <Box flexDirection="row" columnGap={2} alignItems="center">
        <Button key="mini" label="Minimize" plain hotkey={isTerminal ? 'm' : undefined} onPress={() => void setBandMode($, 'compact')} />
        <Button key="hide" label="Hide" plain role="dismiss" onPress={() => void setBandMode($, 'hidden')} />
      </Box>
    )
    if (!f || !r) {
      return (
        <Box flexDirection="row" columnGap={2} alignItems="center">
          <Text dimColor>Context Forecast starts with Claude's first reply.</Text>
          <Box flexGrow={1} />
          {controls}
        </Box>
      )
    }
    const band = buildBand(f, r, list, await $.clock.now())
    const lv = band.level

    const skyIcon = (size: number) => {
      if (isTerminal) {
        const { Raster } = $.ui.resolve(e)
        sky.site = e.requestId
        sky.level = lv
        return <Raster key="sky" columns={SKY_COLUMNS} rows={1} cells={skyCells(lv, sky.frame)} />
      }
      const { Svg } = $.ui.resolve(e)
      return <Svg key="sky" source={skySvg(lv, size)} alt={lv.name} width={size} height={size} />
    }
    const gaugeCellsWide = cols >= 110 ? 22 : 16
    const gauge = () => {
      if (isTerminal) {
        const { Raster } = $.ui.resolve(e)
        return <Raster key="gauge" {...gaugeCells(f, gaugeCellsWide)} />
      }
      const { Svg } = $.ui.resolve(e)
      return (
        <Svg
          key="gauge"
          source={gaugeSvg(f, gaugeCellsWide * PX_PER_CELL)}
          alt={`${Math.round(band.fraction * 100)}% of the way to auto-compact`}
          width={gaugeCellsWide * PX_PER_CELL}
          height={20}
        />
      )
    }
    // The condition keeps its colour outside the button (a button draws its
    // label in its own style); the line after it is the way into the forecast.
    const headline = (
      <Box key="headline" flexDirection="row" columnGap={1} alignItems="center">
        <Text color={lv.color} weight="semibold">
          {lv.name}
        </Text>
        <Button key="forecast" label={`${band.text} ›`} plain hover={{ underline: true }} hotkey={isTerminal ? 'f' : undefined} onPress={() => void togglePane($)} />
      </Box>
    )
    const isNarrow = cols < 80
    const planButton = (variant: 'primary' | 'secondary', label: string) => (
      <Button key="plan" label={label} variant={variant} hotkey={isTerminal ? 'c' : undefined} onPress={() => void planFromBand($)} />
    )
    const line = (
      <Box flexDirection="row" columnGap={2} alignItems="center">
        <Box flexDirection="row" columnGap={1} alignItems="center">
          {skyIcon(22)}
          {headline}
        </Box>
        {!isNarrow && (
          <Box flexDirection="row" columnGap={1} alignItems="center">
            {gauge()}
            <Text tabular dimColor>
              {band.figure.split(/(\d[\d,.]*k?)/).map((part, i) => (i % 2 === 1 ? <Text key={`fig-${i}`} mono tabular>{part}</Text> : part))}
            </Text>
          </Box>
        )}
        {!isNarrow &&
          band.limits.map(l => (
            <Text key={`limit-${l.kind}`} tabular color={l.percent >= 90 ? BAD : undefined} dimColor={l.percent < 90}>
              {l.text}
            </Text>
          ))}
        <Box flexGrow={1} />
        {band.action === 'inline' && planButton('secondary', 'Plan compact')}
        {controls}
      </Box>
    )
    if (band.action !== 'row') return line
    // Storm: the action gets a row of its own, the one thing to do now.
    return (
      <Box flexDirection="column" gap={0}>
        {line}
        <Box flexDirection="row" columnGap={2} alignItems="center">
          <Text color={BAD}>Auto-compact is close. Choose what the summary keeps.</Text>
          <Box flexGrow={1} />
          {planButton('primary', 'Plan compact now')}
        </Box>
      </Box>
    )
  })

  // ---- minimized: the weather in the prompt footer -----------------------------

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const mode = await read($, bandMode)
    if (mode !== 'compact' && mode !== 'auto') return next(e)
    const r = await read($, reading)
    const list = await read($, samples)
    const f = forecast(list, r)
    if (!f || !r) return next(e)
    // Auto: the footer holds the weather only while the band is folded.
    if (mode === 'auto' && !buildBand(f, r, list, await $.clock.now()).isCalm) return next(e)
    const share = `${Math.round(Math.min(f.fraction, 9.99) * 100)}%`
    const { Box, Text, Button } = $.ui.resolve(e)
    const expand = () => void setBandMode($, 'full')
    // The desktop draws this slot as a mode chip and draws only its text, so
    // the weather rides in the label there; the terminal animates its cells.
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      sky.site = e.requestId
      sky.level = f.level
      return (
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          <Raster key="sky" columns={SKY_COLUMNS} rows={1} cells={skyCells(f.level, sky.frame)} />
          <Button key="expand" label={share} plain onPress={expand} />
          {e.props.modes.length > 0 && <Text dimColor> {e.props.modes.join(' & ')}</Text>}
        </Box>
      )
    }
    // The desktop draws this slot as a mode chip around the text of what is
    // drawn here (a Client, having no text, is not drawn at all). The chip's
    // frame is the desktop's; a plain, dim Button keeps the label pressable.
    return (
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        <Button key="expand" label={`${f.level.icon} ${share}`} plain dimColor onPress={expand} />
        {e.props.modes.length > 0 && <Text dimColor> {e.props.modes.join(' & ')}</Text>}
      </Box>
    )
  })


  // ---- the forecast pane ------------------------------------------------------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const input = await panelInput($)
    const panel = buildPanel(input)
    const debug = await read($, debugAtom)
    const surface = e.surface
    return drawPane(panel, {
      els: $.ui.resolve(e),
      surface,
      columns: e.props.bodyColumns,
      view: debug === 'planner' ? 'planner' : await read($, viewAtom),
      isDebugOn: await read($, debugOnAtom),
      debug,
      isConfirming: await read($, confirmAtom),
      extra: await read($, extraAtom),
      actions: {
        openPlanner: () => void openPlanner($),
        closePlanner: () => {
          void update($, viewAtom, () => 'main')
          void read($, debugAtom).then(d => (d === 'planner' ? update($, debugAtom, () => 'cloudy') : undefined))
        },
        toggleChip: id => {
          const chip = panel?.planner?.chips.find(c => c.id === id)
          if (chip) void update($, overridesAtom, o => ({ ...o, [id]: !chip.on }))
          void update($, confirmAtom, () => false)
        },
        setExtra: text => {
          void update($, extraAtom, () => text)
          void update($, confirmAtom, () => false)
        },
        copyMcp: server => void copyMcp($, server, surface),
        viewAgent: id => void viewAgent($, id),
        copyCommand: () => void copyCommand($, surface),
        compactNow: () => void compactNow($),
        setDebug: state => void update($, debugAtom, () => state),
        close: surface === 'terminal' ? () => void $.ui.close({ id: PANE }) : null,
      },
    })
  })
}

// Redraws the pane once a second while it shows a live cache countdown.
// Redraws the pane when the cache countdown it shows changes: each minute,
// and each second in the last five minutes.
let shownCacheLabel = ''
async function tickPane($: Api): Promise<void> {
  try {
    if ((await read($, debugAtom)) || !(await $.ui.panes()).some(p => p.id === PANE)) return
    const c = await read($, cacheAtom)
    if (!c || c.ttlMs === null) return
    const left = c.ttlMs - ((await $.clock.now()) - c.lastRequestAt)
    const label = left <= 0 ? 'cold' : cacheLeft(left)
    if (label === shownCacheLabel) return
    shownCacheLabel = label
    $.ui.invalidate('ui.render')
  } catch {
    // A missed tick is harmless.
  }
}

// Opens the planner and moves the focus to its first toggle, which scrolls it
// into view.
async function openPlanner($: Api): Promise<void> {
  await update($, viewAtom, () => 'planner')
  await update($, confirmAtom, () => false)
  await $.ui.focus({ requestId: PANE, key: PLANNER_FOCUS }).catch(() => undefined)
}

// Disabling a server is /mcp's job: hand the person the command.
async function copyMcp($: Api, server: string, surface: string): Promise<void> {
  const r = await $.ui.copy({ text: '/mcp', surface: surface as never })
  $.ui.toast(r.isCopied ? `Copied /mcp: paste it and turn off ${server}` : `Run /mcp and turn off ${server}`)
}

async function viewAgent($: Api, id: string): Promise<void> {
  const r = await $.ui.view({ agentId: id }).catch((err: Error) => ({ deny: err.message }))
  if (r.deny) $.ui.toast(`This subagent's transcript is not available: ${r.deny}`)
}
