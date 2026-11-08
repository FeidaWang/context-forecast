# Context Forecast

A weather forecast for your Claude Code context window. Instead of a raw token count, you get a condition you can read at a glance, and a warning *before* auto-compaction hits.

## What you see

A band above the prompt shows the current condition, how many turns are left until compaction, how much each turn is adding, and your rate-limit and cost figures.

| Condition | Context used (of the auto-compact threshold) | Meaning |
| --- | --- | --- |
| ☀️ Clear | under 30% | plenty of room |
| ☁️ Cloudy | 30–60% | filling up |
| 🌧️ Rain | 60–85% | compaction ahead |
| ⛈️ Storm | 85%+ | compaction imminent |
| 🌈 Clearing | just compacted | fresh room |

**Turns left** = room to the auto-compact threshold ÷ growth per turn, where growth is the **median of the last ≤8 turn-to-turn deltas since the last compaction**, negative deltas left out. A single big file read barely moves it. Past 99 turns (or with no growth) it reads "Plenty of room"; until it has seen a turn grow, it says "Measuring growth".

### The forecast pane

`/weather forecast` opens a pane (≈360px wide on desktop), top to bottom:

1. **Header**: condition, model, used / window.
2. **Hero**: "~N turns left" to auto-compact, the threshold and typical growth.
3. **Context bar**: one segment per category, the auto-compact reserve gray at the end.
4. **What's in context**: tokens per category. An MCP server with ≥5k of schemas and no calls this session is flagged; **Disable…** copies `/mcp` for you to paste.
5. **Prompt cache**: warm/cold with the time left of its TTL (minutes, then seconds in the last five), read %, tokens written last turn, and what a cold cache would re-write.
6. **Subagents**: each run's context → what it handed back, and the total kept out of the main context. Press a row to open that subagent's transcript.
7. **Limits**: 5-hour and weekly usage with reset times; session cost labelled API-equivalent.
8. **Plan compact** button: quiet in Clear/Cloudy, primary in Rain, full width with a warning in Storm.

The button opens the **compact planner** card and moves the focus to it (beside the main card when the pane is wide enough; under it otherwise, with the main card folded to its top block): Keep (☑/☐) and Drop (☒/☐) toggles derived from the session (task and plan, files edited, decisions, failing test output, user preferences, old search results, large file dumps), the `/compact` instructions they make, a field to add an instruction of your own, the size after compacting, the best moment (idle, cache warm), **Copy command** and **Compact now** (asks once, showing the before → after size, then runs `/compact` with those instructions; waits while a turn runs). Under it, **Next move**: up to three suggestions, each only when its rule fires (last 3 turns read >30k of files → Explore subagent; CLAUDE.md >8k → move sections into a skill; topic shift → new session with its starting size).

Figures marked ~ are estimates. Sections with no data (no subagents, no plan limits off a subscription, unknown cache TTL) are hidden.

### Where each number comes from

| Panel figure | Source |
| --- | --- |
| Used / window, % used | `$.session.usage()` → `context.tokens`, `context.window` (the status line's figures) |
| Model, auto-compact threshold, bar length, reserve | `$.session.usage({ breakdown: 'summary' })` → `breakdown.model`, `autoCompactThreshold`, `rawMaxTokens`, the `buffer` category |
| What's in context | `breakdown.categories` (used rows), folded into groups |
| MCP schema size per server | `breakdown.mcpTools` (loaded schemas) by `serverName` |
| MCP calls | `mcp__<server>__*` tool calls: counted live (`tool.call`) and in `$.session.messages()` |
| CLAUDE.md size | `breakdown.memoryFiles` named `CLAUDE.md` |
| Growth, turns left | each main-thread request's usage (`turn.step`) and turn ends (`session.measure`); history rebuilt from the transcript |
| Cache read %, written last turn | last request's `cache_read/creation_input_tokens` (`turn.step`, `turn.complete`) |
| Cache TTL | the transcript's `usage.cache_creation.ephemeral_1h/5m_input_tokens` |
| Cache countdown | time of the last main-thread response + TTL |
| Subagents | `$.agent.list()` (type, description); each agent's `turn.step` usage (its largest context); its `turn.complete` answer (≈ chars ÷ 4); earlier runs from the session's `subagents/agent-*.meta.json` and `.jsonl` |
| Limits | `usage.rateLimits` (`five_hour`, `seven_day`: `percentUsed`, `resetsAt`) |
| Session cost | `usage.cost.usd` (API-equivalent) |
| Planner chips, next-move rules | `$.session.messages()` (since the last compaction): tool names, inputs and result sizes |
| After-compact estimate | ≈ non-message context + a summary of a tenth of the messages (3k–20k) + anything kept verbatim |

## Install

```
/plugin marketplace add FeidaWang/context-forecast
/plugin install context-forecast@context-forecast
```

Restart Claude Code to apply.

## Commands

| Command | Does |
| --- | --- |
| `/weather` | Show the band (from any state) |
| `/weather forecast` | Open or close the forecast pane and compact planner |
| `/weather debug` | Toggle a preview picker in the pane: Live, Clear, Cloudy, Storm, Planner (fixture data); `/weather debug storm` jumps to one |
| `/weather mini` | Tuck the weather into the prompt footer |
| `/weather hide` | Hide it; `/weather` brings it back |

If another plugin already owns `/weather` (for example the original `token-weather` sample mod), the same command registers as `/context-forecast` instead: `/context-forecast forecast`, `/context-forecast debug storm`, and so on.

The band also has Forecast, minimize and hide buttons. On the terminal, `f` and `m` are hotkeys for Forecast and minimize.

## Works on

Claude Code terminal and desktop surfaces. It is a Claude Code *mod* (UI and hooks), so it has no effect in chat or Cowork.

## What it reads, runs, and sends

Everything runs locally. The mod sends nothing anywhere: it makes no network requests, bundles no MCP server, and calls no model.

- **Reads session usage.** The context size, window, rate-limit percentages and session cost that Claude Code reports for the current session (`$.session.usage`).
- **Reads two environment variables, `HOME` and `CLAUDE_CONFIG_DIR`**, only to work out where Claude Code keeps the current session's transcript (`<config dir>/projects/<project>/<session id>.jsonl`). No credential or secret is read, and the values are never stored or sent.
- **Reads the current session's transcript file** (`$.fs.read`) when a session starts and after each turn, for the token history and the prompt-cache TTL (transcripts over the 4 MiB file-read limit are skipped). Only token counts, cache-write splits, request ids and timestamps are used. Subagent records in the session's `subagents/` folder are read for agent type and token counts.
- **Reads the conversation** (`$.session.messages()`) after each turn, to count tool calls, edited files, searches, large tool results and test failures, and to compare prompt keywords for a topic shift. Only counts and sizes are kept; message text and file paths are not stored or shown.
- **Compacts only when you press Compact now** (`$.session.compact`), with the instructions shown in the preview; **Copy command** writes that `/compact` command to your clipboard.
- **Runs no programs.** The mod starts no processes and makes no shell calls.
- **Handles the `/weather` command itself** (`forecast`, `mini`, `hide`, or no argument). It does not touch permissions, agents, settings, or Remote Control.
- **Keeps state** (recent token samples, last reading, cache and subagent counts, planner choices, display mode) in Claude Code's own plugin state.

See [PRIVACY.md](PRIVACY.md) for the data-handling summary.

## Development

```
claude plugin validate .      # manifest + hooks
claude plugin test .          # unit and UI tests
./scripts/preflight.sh        # everything the directory's checks look at
```

Source: `hooks/forecast.ts` (levels, growth, turns left), `hooks/insights.ts` (context groups, MCP, planner, next-move rules), `hooks/panel.ts` (the pane's figures), `hooks/pane.tsx` (the pane and planner), `hooks/fixtures.ts` (debug previews), `hooks/history.ts` (transcript parsing), `hooks/sky.ts` (animated icons), `hooks/register.tsx` (events, band and `/weather`).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Context Forecast is derived from the `token-weather` sample mod in [anthropics/claude-code-playground](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/token-weather) (Apache-2.0). It is an independent project, not an Anthropic product.
