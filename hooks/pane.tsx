// The forecast pane: the main card and the compact planner card, drawn from
// a Panel (panel.ts). Flat surfaces, hairline dividers, sentence case, two
// weights, mono for value columns; no label the layout already says.

import type { EngineInterface, RenderElement } from 'claude-code'

import type { DebugState, PaneView } from '../types'
import { BAD, GOOD, isAlertRank } from './forecast'
import { RESERVE_COLOR, fmtK, fmtK1, fmtKs } from './insights'
import type { Panel } from './panel'
import { skySvg } from './sky'

type Api = EngineInterface
type Els = ReturnType<Api['ui']['resolve']>
type SvgEl = ReturnType<Api['ui']['resolve']> extends infer T ? (T extends { Svg: infer S } ? S : never) : never
type SelectEl = ReturnType<Api['ui']['resolve']> extends infer T ? (T extends { Select: infer S } ? S : never) : never
type InputEl = ReturnType<Api['ui']['resolve']> extends infer T ? (T extends { Input: infer S } ? S : never) : never

// The desktop draws a pane cell about 8.8px wide (measured), so 360px of
// content is 41 cells.
export const MAX_CELLS = 41
const CARD_GAP = 4
const HAIRLINE = '#8a8f98'
// Graphics are drawn this wide and capped to their slot: with no `width` on
// the Svg, the surface sizes the box to the slot and `preserveAspectRatio`
// "none" stretches the drawing across it, so bars match the text column.
const STRETCH = 4000
const VB = 1000
// The first element the planner focuses when it opens, so it scrolls into view.
export const PLANNER_FOCUS = 'chip-task'

export type PaneActions = {
  openPlanner: () => void
  closePlanner: () => void
  toggleChip: (id: string) => void
  setExtra: (text: string) => void
  copyCommand: () => void
  compactNow: () => void
  copyMcp: (server: string) => void
  viewAgent: (id: string) => void
  setDebug: (state: DebugState) => void
  close: (() => void) | null
}

export type PaneContext = {
  els: Els
  surface: string
  columns: number
  view: PaneView
  isDebugOn: boolean
  debug: DebugState
  isConfirming: boolean
  extra: string
  actions: PaneActions
}

// Minutes while there is time; seconds only in the last five minutes.
export function cacheLeft(ms: number): string {
  if (ms > 5 * 60_000) {
    const m = Math.floor(ms / 60_000)
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
  }
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const stretchOpen = (h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${STRETCH}" height="${h}" viewBox="0 0 ${VB} ${h}" preserveAspectRatio="none">`

// A half-pixel rule across the column (1 device pixel on a 2x screen).
export function hairlineSvg(): string {
  return `${stretchOpen(1)}<rect width="${VB}" height=".5" fill="${HAIRLINE}" fill-opacity=".7"/></svg>`
}

// The context bar: one flat segment per group over the window, a thin gap
// between segments, the compaction reserve gray at the end.
export function contextBarSvg(p: Panel): string {
  const h = 8
  const parts = [stretchOpen(h), `<rect width="${VB}" height="${h}" fill="${HAIRLINE}" fill-opacity=".16"/>`]
  const scale = VB / Math.max(1, p.barMax)
  let x = 0
  for (const g of p.groups) {
    const gw = g.tokens * scale
    if (gw >= 0.5) parts.push(`<rect x="${x.toFixed(2)}" width="${Math.max(0.5, gw - 2).toFixed(2)}" height="${h}" fill="${g.color}"/>`)
    x += gw
  }
  if (p.reserve > 0) {
    const rw = p.reserve * scale
    parts.push(`<rect x="${(VB - rw).toFixed(2)}" width="${rw.toFixed(2)}" height="${h}" fill="${RESERVE_COLOR}" fill-opacity=".55"/>`)
  }
  parts.push('</svg>')
  return parts.join('')
}

export function meterSvg(fraction: number, color: string): string {
  const fw = Math.min(1, Math.max(0, fraction)) * VB
  return `${stretchOpen(4)}<rect width="${VB}" height="4" fill="${HAIRLINE}" fill-opacity=".18"/><rect width="${fw.toFixed(1)}" height="4" fill="${color}"/></svg>`
}

function limitColor(percent: number): string {
  return percent >= 90 ? BAD : percent >= 75 ? '#ec835a' : percent >= 50 ? '#d39a12' : '#b4b2a9'
}

// One number token: no spaces inside, so mono never widens a gap.
const NUMBER = /([~+$]?\d[\d,.:]*(?:k|%|m|h|s)?)/g

// Shared drawing helpers for both cards.
function kit(x: PaneContext, cells: number) {
  const { els } = x
  const { Box, Text } = els
  const Svg = 'Svg' in els ? (els as { Svg: SvgEl }).Svg : null
  // A value column: its numbers in mono, any words between them in the body face.
  const num = (key: string, s: string, opts: { color?: string; dim?: boolean } = {}) => (
    <Text key={key} color={opts.color} dimColor={opts.dim}>
      {s.split(NUMBER).map((part, i) =>
        i % 2 === 1 ? (
          <Text key={`${key}-${i}`} mono tabular>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  )
  // Running text: the body face with even-width digits.
  const prose = (key: string, s: string, opts: { color?: string; dim?: boolean } = {}) => (
    <Text key={key} tabular color={opts.color} dimColor={opts.dim}>
      {s}
    </Text>
  )
  const rule = (key: string) =>
    Svg ? <Svg key={key} source={hairlineSvg()} alt="divider" height={1} /> : <Text key={key} dimColor>{'─'.repeat(cells)}</Text>
  const meter = (key: string, fraction: number, color: string) => {
    if (Svg) return <Svg key={key} source={meterSvg(fraction, color)} alt={`${Math.round(fraction * 100)}%`} height={4} />
    const n = Math.round(Math.min(1, Math.max(0, fraction)) * cells)
    return (
      <Text key={key}>
        <Text color={color}>{'━'.repeat(n)}</Text>
        <Text dimColor>{'─'.repeat(cells - n)}</Text>
      </Text>
    )
  }
  const row = (key: string, left: RenderElement | string, right: RenderElement | string | null) => (
    <Box key={key} flexDirection="row" columnGap={1} alignItems="center">
      <Box flexShrink={1}>{typeof left === 'string' ? prose(`${key}-l`, left) : left}</Box>
      <Box flexGrow={1} />
      {right === null ? null : typeof right === 'string' ? num(`${key}-v`, right) : right}
    </Box>
  )
  const title = (key: string, text: string, right?: RenderElement | null) => (
    <Box key={key} flexDirection="row" columnGap={1} alignItems="center">
      <Text weight="semibold">{text}</Text>
      <Box flexGrow={1} />
      {right ?? null}
    </Box>
  )
  // Sections with a hairline between each.
  const stack = (key: string, sections: (RenderElement | null)[], width: number) => {
    const shown = sections.filter((s): s is RenderElement => s !== null)
    return (
      <Box key={key} flexDirection="column" width={width} gap={1}>
        {shown.flatMap((s, i) => (i === 0 ? [s] : [rule(`${key}-rule-${i}`), s]))}
      </Box>
    )
  }
  return { Svg, num, prose, rule, meter, row, title, stack }
}

const DEBUG_STATES = ['live', 'clear', 'cloudy', 'storm', 'planner'] as const

export function drawPane(p: Panel | null, x: PaneContext): RenderElement {
  const { Box, Text } = x.els
  const isWide = x.columns >= MAX_CELLS * 2 + CARD_GAP
  const cells = Math.max(24, Math.min(MAX_CELLS, x.columns))
  const k = kit(x, cells)

  // A developer's switch, kept quiet: one picker, ruled off from the content.
  let debugStrip: RenderElement | null = null
  if (x.isDebugOn) {
    const Select = 'Select' in x.els ? (x.els as { Select: SelectEl }).Select : null
    const { Button } = x.els
    debugStrip = (
      <Box key="debug" flexDirection="column" width={isWide ? cells * 2 + CARD_GAP : cells} gap={0}>
        {Select ? (
          <Select
            key="debug-state"
            label="Preview"
            value={x.debug ?? 'live'}
            options={DEBUG_STATES.map(s => ({ value: s, label: `${s[0]!.toUpperCase()}${s.slice(1)}` }))}
            onSelect={v => x.actions.setDebug(v === 'live' ? null : (v as DebugState))}
          />
        ) : (
          <Box flexDirection="row" columnGap={1} flexWrap="wrap">
            {DEBUG_STATES.map(s => (
              <Button key={`debug-${s}`} label={`${(x.debug ?? 'live') === s ? '● ' : ''}${s}`} plain dimColor onPress={() => x.actions.setDebug(s === 'live' ? null : s)} />
            ))}
          </Box>
        )}
        {k.rule('debug-rule')}
      </Box>
    )
  }

  if (!p) {
    return (
      <Box flexDirection="column" gap={1} width={cells}>
        {debugStrip}
        <Text dimColor>The forecast starts with Claude's first reply.</Text>
      </Box>
    )
  }

  // The planner sits beside the main card where there is room. Where there is
  // not, the main card folds to its top block (condition, turns left, bar) so
  // the planner opens in view with the figures it plans from above it.
  const showPlanner = x.view === 'planner' && p.planner !== null
  const isFolded = showPlanner && !isWide
  const cards: RenderElement[] = [mainCard(p, x, cells, { withFooter: !showPlanner, isFolded })]
  if (showPlanner) cards.push(plannerCard(p, x, cells))
  return (
    <Box flexDirection="column" gap={1}>
      {debugStrip}
      <Box flexDirection={isWide ? 'row' : 'column'} columnGap={CARD_GAP} rowGap={1} alignItems="flex-start">
        {cards}
      </Box>
    </Box>
  )
}

function mainCard(p: Panel, x: PaneContext, cells: number, o: { withFooter: boolean; isFolded: boolean }): RenderElement {
  const { Box, Text, Button } = x.els
  const k = kit(x, cells)
  const lv = p.level
  const isTerminal = x.surface === 'terminal'

  const header = (
    <Box key="header" flexDirection="row" columnGap={1} alignItems="center">
      {k.Svg ? <k.Svg key="sky" source={skySvg(lv, 20)} alt={lv.name} width={20} height={20} /> : <Text>{lv.icon}</Text>}
      <Text color={lv.color} weight="semibold">
        {lv.name}
      </Text>
      <Box flexGrow={1} />
      <Text dimColor>
        {p.model ? `${p.model} · ` : ''}
        <Text mono tabular>
          {fmtKs(p.tokens)} / {fmtKs(p.window)}
        </Text>
      </Text>
    </Box>
  )

  const sub = [
    p.threshold !== null ? `Auto-compact at ~${fmtKs(p.threshold)}` : 'Auto-compact off',
    p.growth !== null && p.growth > 0 ? `typical +${fmtKs(p.growth)} per turn` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  let bar: RenderElement
  if (k.Svg) {
    bar = <k.Svg key="bar" source={contextBarSvg(p)} alt={`${p.usedPercent}% used; ${p.groups.map(g => `${g.label} ${fmtK(g.tokens)}`).join(', ')}`} height={8} />
  } else {
    const scale = cells / Math.max(1, p.barMax)
    const reserveCells = Math.round(p.reserve * scale)
    let left = cells - reserveCells
    const segs = p.groups.map(g => {
      const n = Math.min(left, Math.round(g.tokens * scale))
      left -= n
      return <Text key={`seg-${g.key}`} color={g.color}>{'█'.repeat(n)}</Text>
    })
    bar = (
      <Text key="bar">
        {segs}
        <Text dimColor>{'░'.repeat(Math.max(0, left))}</Text>
        <Text dimColor>{'▒'.repeat(reserveCells)}</Text>
      </Text>
    )
  }

  // Header, hero and bar read as one block: no rules between them.
  const top = (
    <Box key="top" flexDirection="column" gap={1}>
      {header}
      <Box flexDirection="column">
        <Text size="title" weight="semibold">
          {p.hero}
        </Text>
        {k.prose('sub', sub, { dim: true })}
      </Box>
      <Box flexDirection="column" gap={0}>
        {bar}
        {k.row('captions', k.prose('used', `${p.usedPercent}% used`, { dim: true }), p.reserve > 0 ? <Text dimColor>reserved for compact</Text> : null)}
      </Box>
    </Box>
  )
  if (o.isFolded) return k.stack('main', [top], cells)

  const context = (
    <Box key="context" flexDirection="column">
      {k.title('ctx-title', "What's in context")}
      {p.groups.map(g =>
        k.row(
          `g-${g.key}`,
          <Text>
            <Text color={g.color}>■</Text> {g.label}
          </Text>,
          fmtK(g.tokens),
        ),
      )}
      {p.mcpFlag &&
        k.row(
          'mcp-flag',
          k.prose('mcp-flag-l', `${p.mcpFlag.name} · ${fmtK(p.mcpFlag.tokens)}, never called`, { dim: true }),
          <Button key="mcp-disable" label="Disable…" plain onPress={() => x.actions.copyMcp(p.mcpFlag!.name)} />,
        )}
    </Box>
  )

  let cache: RenderElement | null = null
  if (p.cache) {
    const c = p.cache
    const ttl = c.ttlMs === null ? null : c.ttlMs >= 3_600_000 ? '1h' : '5m'
    // The bar is the cache's remaining life; the title says so in words.
    const state =
      c.isWarm === null
        ? null
        : c.isWarm
          ? k.num('cache-state', `warm · ${cacheLeft(c.remainingMs ?? 0)} of ${ttl} left`, { color: GOOD })
          : k.num('cache-state', `cold · ${ttl} TTL`, { color: BAD })
    cache = (
      <Box key="cache" flexDirection="column" gap={0}>
        {k.title('cache-title', 'Prompt cache', state)}
        {c.ttlMs !== null && k.meter('cache-meter', (c.remainingMs ?? 0) / c.ttlMs, c.isWarm ? GOOD : BAD)}
        {k.row('cache-read', 'Read from cache', c.readPercent !== null ? `${c.readPercent.toFixed(1)}%` : '—')}
        {c.wrote !== null && k.row('cache-wrote', 'Written last turn', fmtK(c.wrote))}
        {k.row('cache-cold', c.isWarm === false ? 'Next turn re-writes' : 'Re-written if it goes cold', `~${fmtKs(c.rewrite)} tokens`)}
      </Box>
    )
  }

  let agents: RenderElement | null = null
  if (p.agents) {
    agents = (
      <Box key="agents" flexDirection="column">
        {k.title('agents-title', `Subagents · ${p.agents.rows.length}`, <Text dimColor>context → returned</Text>)}
        {p.agents.rows.map(a =>
          k.row(
            `agent-${a.id}`,
            <Button key={`agent-open-${a.id}`} label={`${a.type}${a.isRunning ? ' · running' : a.description ? ` · ${a.description}` : ''}`} plain onPress={() => x.actions.viewAgent(a.id)} />,
            k.num(`agent-${a.id}-v`, a.isRunning || a.returned === null ? fmtKs(a.input) : `${fmtKs(a.input)} → ${fmtK1(a.returned)}`, { color: a.isRunning ? GOOD : undefined }),
          ),
        )}
        {p.agents.kept > 0 && k.prose('kept', `Kept ~${fmtKs(p.agents.kept)} out of your main context`, { dim: true })}
      </Box>
    )
  }

  const limits =
    p.limits.length > 0 || p.usd !== null ? (
      <Box key="limits" flexDirection="column" gap={1}>
        {p.limits.map(l => (
          <Box key={`limit-${l.kind}`} flexDirection="column" gap={0}>
            {k.row(`limit-${l.kind}-row`, l.label, `${Math.round(l.percent)}%${l.reset ? ` · ${l.reset}` : ''}`)}
            {k.meter(`limit-${l.kind}-bar`, l.percent / 100, limitColor(l.percent))}
          </Box>
        ))}
        {p.usd !== null && k.row('cost', 'This session', `~$${p.usd.toFixed(2)} API-equivalent`)}
      </Box>
    ) : null

  const isStorm = lv.rank === 3
  const footer = o.withFooter ? (
    <Box key="footer" flexDirection="column" gap={1}>
      {isStorm && (
        <Text key="storm-banner" color={BAD}>
          {p.hero === 'Compacting next turn' ? 'Auto-compact next turn.' : `${p.hero.replace(/^~/, 'About ')} before auto-compact.`}
        </Text>
      )}
      <Box flexDirection="row" columnGap={1}>
        {x.actions.close && <Button key="close" label="Close" plain dimColor hotkey="x" role="dismiss" onPress={x.actions.close} />}
        {!isStorm && <Box flexGrow={1} />}
        <Box flexGrow={isStorm ? 1 : 0} flexDirection="column" alignItems="stretch">
          <Button
            key="compact"
            label={isStorm ? 'Plan compact now' : 'Plan compact'}
            variant={isAlertRank(lv.rank) ? 'primary' : 'secondary'}
            hotkey={isTerminal ? 'c' : undefined}
            onPress={x.actions.openPlanner}
          />
        </Box>
      </Box>
    </Box>
  ) : null

  return k.stack('main', [top, context, cache, agents, limits, footer], cells)
}

// A toggle's mark: keep ☑/☐, drop ☒/☐, so a mark never means two things.
export function chipMark(side: 'keep' | 'drop', on: boolean): string {
  return on ? (side === 'keep' ? '☑' : '☒') : '☐'
}

function plannerCard(p: Panel, x: PaneContext, cells: number): RenderElement {
  const { Box, Text, Button } = x.els
  const k = kit(x, cells)
  const pl = p.planner!
  const Input = 'Input' in x.els ? (x.els as { Input: InputEl }).Input : null
  // Toggles at full strength, told apart by their box, never by dimming
  // (dim reads as disabled) and never in the primary action's fill.
  const chip = (c: (typeof pl.chips)[number]) => (
    <Button key={`chip-${c.id}`} label={`${chipMark(c.side, c.on)} ${c.label}`} plain onPress={() => x.actions.toggleChip(c.id)} />
  )
  const chips = (side: 'keep' | 'drop', label: string) => {
    const list = pl.chips.filter(c => c.side === side)
    if (list.length === 0) return null
    return (
      <Box key={side} flexDirection="column" gap={0}>
        <Text dimColor>{label}</Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} rowGap={0}>
          {list.map(chip)}
        </Box>
      </Box>
    )
  }
  const compactLabel = !pl.canCompact
    ? 'Compact after this turn'
    : x.isConfirming
      ? `Confirm · ${fmtKs(pl.before)} → ~${fmtKs(pl.after)}`
      : 'Compact now'
  const plan = (
    <Box key="plan" flexDirection="column" gap={1}>
      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Text weight="semibold">Compact planner</Text>
        <Box flexGrow={1} />
        <Button key="back" label="Close" plain dimColor hotkey={x.surface === 'terminal' ? 'b' : undefined} role="dismiss" onPress={x.actions.closePlanner} />
      </Box>
      {chips('keep', 'Keep')}
      {chips('drop', 'Drop')}
      <Box key="preview" flexDirection="column" paddingX={1} borderStyle="round" borderDimColor>
        <Text mono>{pl.instructions}</Text>
      </Box>
      {Input && (
        <Input
          key="extra"
          placeholder="Add an instruction"
          value={x.extra}
          submitLabel="Add"
          onInput={v => x.actions.setExtra(v)}
          onSubmit={v => x.actions.setExtra(v)}
        />
      )}
      <Box flexDirection="column" gap={0}>
        {k.row('after', 'Estimated after compact', `${fmtKs(pl.before)} → ~${fmtKs(pl.after)}`)}
        {k.row('best', 'Best moment', k.prose('best-v', pl.best.text, pl.best.isGood ? { color: GOOD } : { dim: true }))}
      </Box>
      {/* A button sizes to its label, so the pair holds the column's two edges. */}
      <Box key="planner-buttons" flexDirection="row" columnGap={1}>
        <Button key="copy" label="Copy command" variant="secondary" onPress={x.actions.copyCommand} />
        <Box flexGrow={1} />
        <Button key="compact-now" label={compactLabel} variant="primary" onPress={x.actions.compactNow} />
      </Box>
      {x.isConfirming && k.prose('confirm-note', 'Compacting replaces the conversation with a summary; it cannot be undone.', { dim: true })}
    </Box>
  )
  const moves =
    p.moves.length > 0 ? (
      <Box key="moves" flexDirection="column" gap={1}>
        {k.title('moves-title', 'Next move')}
        {p.moves.map(m => (
          <Box key={`move-${m.id}`} flexDirection="row" columnGap={1} alignItems="flex-start">
            <Text color="suggestion">→</Text>
            <Box flexShrink={1}>{k.prose(`move-${m.id}-t`, m.text)}</Box>
          </Box>
        ))}
      </Box>
    ) : null
  return k.stack('planner', [plan, moves], cells)
}
