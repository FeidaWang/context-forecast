import { expect, mock, test } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'

import { parseTranscript } from '../hooks/history'

const SURFACES = ['terminal', 'desktop'] as const

function usageAt(tokens: number): SessionUsage {
  return {
    startedAt: 0,
    context: {
      tokens,
      window: 200_000,
      percent: Math.round((tokens / 200_000) * 100),
      breakdown: {
        categories: [
          { name: 'Messages', tokens: tokens - 20_000, color: 'x', isDeferred: false, kind: 'used' },
          { name: 'System tools', tokens: 20_000, color: 'x', isDeferred: false, kind: 'used' },
        ],
        totalTokens: tokens,
        maxTokens: 200_000,
        rawMaxTokens: 200_000,
        autocompactSource: 'model-default',
        percentage: 0,
        gridRows: [],
        model: 'claude',
        memoryFiles: [],
        mcpTools: [],
        agents: [],
        autoCompactThreshold: 160_000,
        isAutoCompactEnabled: true,
        apiUsage: null,
      },
    },
    rateLimits: [{ kind: 'five_hour', percentUsed: 41 }],
    cost: { usd: 1.23 },
  }
}

test('band and forecast draw on terminal and desktop', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  let tokens = 40_000
  on('session.usage', () => ({ value: usageAt(tokens) }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  // The engine's own drawing, where the mod steps aside: nothing.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  for (const t of [40_000, 52_000, 66_000, 81_000]) {
    tokens = t
    await $.session.measure({ context: usageAt(t).context, rateLimits: [], changed: ['context'] })
  }

  for (const surface of SURFACES) {
    const band = await $.ui.mount({
      plugin: 'context-forecast',
      surface,
      component: 'AbovePrompt',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: 140,
        scroll: { offset: 0, bodyRows: 10 },
        view: {},
      },
    })
    // 81k of a 160k compaction point: about half way, "Cloudy".
    expect(await band.find({ type: 'Text', text: /Cloudy/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /~6 turns left/ })).toBeDefined()
    expect(await band.find({ key: 'forecast' })).toBeDefined()
    expect(await band.find({ key: 'hide' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /5h limit/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /per turn/ })).toBeDefined()
    // Minimized, the weather moves into the prompt footer beside the model
    // selector; its percentage brings the band back.
    await band.press({ key: 'mini' })
    expect(await band.find({ key: 'forecast' })).toBeUndefined()
    const footer = await $.ui.mount({ plugin: 'context-forecast', surface, component: 'SessionMode', props: { modes: [] } })
    expect(await footer.find({ key: 'expand' })).toBeDefined()
    await footer.press({ key: 'expand' })
    expect(await footer.find({ key: 'expand' })).toBeUndefined()
    await footer.unmount()
    expect(await band.find({ key: 'forecast' })).toBeDefined()
    await band.unmount()

    // Narrow: one line of the essentials, the stat blocks dropped.
    const slim = await $.ui.mount({
      plugin: 'context-forecast',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 50, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    })
    expect(await slim.find({ type: 'Text', text: /per turn/ })).toBeUndefined()
    expect(await slim.find({ type: 'Text', text: /cache hit/ })).toBeUndefined()
    expect(await slim.find({ key: 'forecast' })).toBeDefined()
    await slim.unmount()

    const pane = await $.ui.mount({
      plugin: 'context-forecast',
      surface,
      component: 'Pane',
      requestId: 'context-forecast',
      props: {
        title: 'Context Forecast',
        isFocused: false,
        bodyColumns: 80,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    })
    expect(await pane.find({ type: 'Text', text: '~6 turns left' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Auto-compact at ~160k · typical \+14k per turn/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: "What's in context" })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Messages and tool results/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /5-hour session/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /~\$1\.23 API-equivalent/ })).toBeDefined()
    expect(await pane.find({ key: 'compact' })).toBeDefined()
    if (surface === 'desktop') {
      // The context bar, the limit meter and the hairlines.
      expect((await pane.findAll({ type: 'Svg' })).length).toBeGreaterThanOrEqual(4)
    } else {
      expect(await pane.find({ type: 'Svg' })).toBeUndefined()
    }
    await pane.unmount()
  }
})

test('history rebuilds from a transcript', async () => {
  const req = (id: string, cached: number, out = 100) =>
    JSON.stringify({
      type: 'assistant',
      requestId: id,
      timestamp: '2026-10-04T15:11:01.970Z',
      message: { usage: { input_tokens: 2, cache_read_input_tokens: cached, cache_creation_input_tokens: 0, output_tokens: out } },
    })
  const prompt = JSON.stringify({ type: 'user', message: { content: 'hi' } })
  const result = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] } })
  const lines = [
    prompt, req('a', 1000), req('a', 1000), result, req('b', 2000), prompt, req('c', 3000),
    JSON.stringify({ type: 'system', subtype: 'compact_boundary' }), prompt, req('d', 500),
    JSON.stringify({ type: 'assistant', isSidechain: true, requestId: 'e', message: { usage: { input_tokens: 9 } } }),
  ]
  const s = parseTranscript(lines.join('\n'))
  expect(s.map(x => x.tokens)).toEqual([1002, 2002, 3002, 502])
  expect(s.map(x => x.isTurnEnd)).toEqual([false, true, true, false])
  expect(s.map(x => x.isCompaction)).toEqual([false, false, false, true])
})

test('every condition draws its sky on the terminal and desktop', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  let tokens = 0
  on('session.usage', () => ({ value: usageAt(tokens) }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  // 160k is the compaction point: clear, cloudy, rain, storm, then a
  // compaction (the clearing).
  const steps: [number, RegExp][] = [
    [40_000, /Clear/], [70_000, /Cloudy/], [110_000, /Rain/], [150_000, /Storm/], [50_000, /Clearing/],
  ]
  for (const [t, name] of steps) {
    tokens = t
    await $.session.measure({ context: usageAt(t).context, rateLimits: [], changed: ['context'] })
    for (const surface of SURFACES) {
      const band = await $.ui.mount({
        plugin: 'context-forecast',
        surface,
        component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140, scroll: { offset: 0, bodyRows: 10 }, view: {} },
      })
      expect(await band.find({ type: 'Text', text: name })).toBeDefined()
      if (surface === 'terminal') {
        expect(await band.find({ type: 'Raster', key: 'sky' })).toBeDefined()
      } else {
        // The animated icon is the Svg that carries the condition's name.
        const svgs = await band.findAll({ type: 'Svg' })
        expect(svgs.some(svg => JSON.stringify(svg).includes('@keyframes'))).toBe(true)
      }
      await band.unmount()
    }
  }
})

test('/weather shows the band; /weather forecast opens the pane', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  on('session.usage', () => ({ value: usageAt(60_000) }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  // The engine's toast and panes, beneath the mod.
  on('ui.toast', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.measure({ context: usageAt(60_000).context, rateLimits: [], changed: ['context'] })
  const presentation = { isFullscreen: false, columns: 140 } as never
  const run = (args: string) => $.command.run({ command: 'weather', args, origin: { kind: 'composer' } as never, presentation })
  await run('hide')
  const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140, scroll: { offset: 0, bodyRows: 10 }, view: {} }
  let band = await $.ui.mount({ plugin: 'context-forecast', surface: 'desktop', component: 'AbovePrompt', props })
  expect(await band.find({ key: 'forecast' })).toBeUndefined()
  await band.unmount()
  expect((await run('')).text).toMatch(/band shown/)
  band = await $.ui.mount({ plugin: 'context-forecast', surface: 'desktop', component: 'AbovePrompt', props })
  expect(await band.find({ key: 'forecast' })).toBeDefined()
  await band.unmount()
  expect((await run('forecast')).text).toMatch(/Forecast (opened|closed)/)
})

const PANE_PROPS = {
  title: 'Context Forecast',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
} as const

test('debug preview: each state draws; the planner builds, copies and compacts', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  on('session.usage', () => ({ value: usageAt(60_000) }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [{ id: 'context-forecast' }] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let copied = ''
  on('ui.copy', ($, e) => ((copied = e.text), { value: { isCopied: true } }))
  let compacted: string | undefined
  on('session.compact', ($, e) => ((compacted = e.instructions), { messages: [{ role: 'user', text: 'Summary', toolUses: [] }], tokensBefore: 120_000, tokensAfter: 30_000 }))
  const presentation = { isFullscreen: false, columns: 140 } as never
  const run = (args: string) => $.command.run({ command: 'weather', args, origin: { kind: 'composer' } as never, presentation })
  expect((await run('debug')).text).toMatch(/Debug preview on/)

  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ plugin: 'context-forecast', surface, component: 'Pane', requestId: 'context-forecast', props: PANE_PROPS })
    await pane.select({ key: 'debug-state', value: 'clear' })
    expect(await pane.find({ type: 'Text', text: 'Plenty of room' })).toBeDefined()
    await pane.select({ key: 'debug-state', value: 'cloudy' })
    expect(await pane.find({ type: 'Text', text: '~14 turns left' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /figma · 9\.8k, never called/ })).toBeDefined()
    expect(await pane.find({ key: 'mcp-disable' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Kept ~143k out of your main context/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '61k → 0.8k' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /32% · resets \w{3} \d+/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /warm · 52m of 1h left/ })).toBeDefined()
    await pane.select({ key: 'debug-state', value: 'storm' })
    expect(await pane.find({ type: 'Text', text: /About 2 turns left before auto-compact/ })).toBeDefined()
    // Next move lives with the planner; the compact button opens it.
    expect(await pane.find({ type: 'Text', text: /The topic changed/ })).toBeUndefined()
    await pane.press({ key: 'compact' })
    expect(await pane.find({ type: 'Text', text: 'Compact planner' })).toBeDefined()
    // The main card stays in view above (or beside) the planner.
    expect(await pane.find({ type: 'Text', text: 'Storm' })).toBeDefined()
    // Chips are toggles with a check, apart from the primary action.
    expect(await pane.find({ key: 'chip-task' })).toMatchObject({ props: { label: '☑ Current task and plan' } })
    expect(await pane.find({ key: 'chip-tests' })).toMatchObject({ props: { label: '☐ Failing test output' } })
    expect(await pane.find({ key: 'chip-search' })).toMatchObject({ props: { label: '☒ Old search results' } })
    expect(await pane.find({ type: 'Text', text: /The topic changed 6 turns ago\. A new session would start at 88k, not 406k\./ })).toBeDefined()
    await pane.press({ key: 'chip-tests' })
    expect(await pane.find({ type: 'Text', text: /the failing test output verbatim/ })).toBeDefined()
    await pane.press({ key: 'copy' })
    expect(copied).toMatch(/^\/compact Keep the current task, plan/)
    expect(copied).toContain('failing test output')
    await pane.press({ key: 'chip-tests' })
    // A typed instruction joins the planned ones.
    await pane.input({ key: 'extra', text: 'Keep the API contract' })
    expect(await pane.find({ type: 'Text', text: /Drop raw search output and file dumps\. Keep the API contract\./ })).toBeDefined()
    // Compact now asks once before it acts, and a preview never compacts.
    await pane.press({ key: 'compact-now' })
    expect(await pane.find({ key: 'compact-now' })).toMatchObject({ props: { label: expect.stringMatching(/^Confirm · /) } })
    await pane.press({ key: 'compact-now' })
    expect(compacted).toBeUndefined()
    await pane.input({ key: 'extra', text: '' })
    await pane.press({ key: 'back' })
    await pane.select({ key: 'debug-state', value: 'planner' })
    expect(await pane.find({ type: 'Text', text: /Now · idle, cache warm/ })).toBeDefined()
    await pane.select({ key: 'debug-state', value: 'live' })
    await pane.unmount()
  }
  expect((await run('debug')).text).toMatch(/Debug preview off/)
})

test('compact now sends the planned instructions and restarts the forecast', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  on('session.usage', () => ({ value: usageAt(120_000) }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'Fix the auth refresh bug', toolUses: [] },
      { role: 'assistant', text: '', toolUses: [{ tool: 'Edit', input: { file_path: '/a.ts' }, text: 'ok' }] },
      { role: 'assistant', text: '', toolUses: [{ tool: 'Grep', input: { pattern: 'x' }, text: 'hits' }] },
      { role: 'user', text: 'and the tests', toolUses: [] },
    ],
  }))
  let compacted: string | undefined
  on('session.compact', ($, e) => ((compacted = e.instructions), { messages: [{ role: 'user', text: 'Summary', toolUses: [] }], tokensBefore: 120_000, tokensAfter: 30_000 }))
  on('turn.complete', () => ({ text: 'done' }))
  for (const t of [80_000, 100_000, 120_000]) await $.session.measure({ context: usageAt(t).context, rateLimits: [], changed: ['context'] })
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1, isAborted: false, reason: 'answer' } as never)

  const pane = await $.ui.mount({ plugin: 'context-forecast', surface: 'desktop', component: 'Pane', requestId: 'context-forecast', props: PANE_PROPS })
  await pane.press({ key: 'compact' })
  expect(await pane.find({ type: 'Text', text: /Keep the current task, plan, the 1 edited file path/ })).toBeDefined()
  await pane.press({ key: 'compact-now' })
  expect(compacted).toBeUndefined()
  await pane.press({ key: 'compact-now' })
  expect(compacted).toBe('Keep the current task, plan, the 1 edited file path and the decisions made. Drop raw search output.')
  // The forecast restarts from the compaction: the clearing, growth re-measured.
  expect(await pane.find({ type: 'Text', text: /Clearing/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Measuring growth' })).toBeDefined()
  await pane.unmount()
})

test('when another plugin holds /weather, the command answers as /context-forecast', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  const registered: string[] = []
  on('command.register', ($, e) => {
    if (e.name === 'weather') throw new Error('"/weather" refused: the plugin token-weather registered it already')
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: usageAt(60_000) }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(registered).toEqual(['context-forecast'])
  const presentation = { isFullscreen: false, columns: 140 } as never
  const r = await $.command.run({ command: 'context-forecast', args: 'debug storm', origin: { kind: 'composer' } as never, presentation })
  expect(r.text).toBe('Previewing storm.')
})
