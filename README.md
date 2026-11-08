# Context Forecast

English | [简体中文](README.zh-CN.md)

**A weather forecast for Claude's memory.** It tells you, at a glance, how much room Claude has left in this conversation, and warns you *before* Claude has to squeeze it.

## The idea in 30 seconds

- Claude can only keep so much of a conversation in mind at once. That space is called the **context window**. Every message, file it reads and tool result fills it up a little more.
- When it gets nearly full, Claude Code **auto-compacts**: it replaces the older conversation with a short summary to make room. That works, but details can get lost, and it usually happens at a moment you didn't choose.
- Context Forecast turns "how full is it?" into **weather**, and guesses **how many more turns** you have before auto-compact. When the sky darkens, it helps you compact **on your terms**, keeping what matters.

| Weather | How full (on the way to auto-compact) | What it means for you |
| --- | --- | --- |
| ☀️ Clear | under 30% | Lots of room. Carry on. |
| ☁️ Cloudy | 30–60% | Filling up. Nothing to do yet. |
| 🌧️ Rain | 60–85% | Auto-compact is coming. A good time to plan one yourself. |
| ⛈️ Storm | 85% or more | Auto-compact is about to happen. Compact now if you care what's kept. |
| 🌈 Clearing | just compacted | Fresh room again. |

## Install

In Claude Code, type these two lines:

```
/plugin marketplace add FeidaWang/context-forecast
/plugin install context-forecast@context-forecast
```

Then restart Claude Code. That's it: the weather shows up by itself after Claude's first reply.

Works in the Claude Code terminal and the Claude desktop app (Code tab). It does nothing in regular chat or Cowork.

## Using it

### 1. Glance at the weather

While things are calm, the weather sits quietly at the bottom of the prompt box, next to the model name, like `☀ 17%`. Press it to see more.

When it's worth watching (from Cloudy on, once fewer than 100 turns are left; or a usage limit past 75%), a **one-line band** appears above the prompt by itself. It reads like:

> 🌧️ Rain · ~12 turns until auto-compact › &nbsp; ▬▬▬▬▬▬▭ 610k / 1M

- **~12 turns** is the forecast: about how many more back-and-forths fit before auto-compact.
- The bar and `610k / 1M` show how full it is (k = thousand tokens, roughly ¾ of a word each).
- Press the line to open the full forecast. **Minimize** tucks it back into the footer; **Hide** removes it.
- In Rain and Storm the band also offers **Plan compact**.

### 2. Open the forecast

Press the band, or type `/weather forecast`. A side pane opens with, from top to bottom:

- **The headline**: today's weather, the model, how much is used, and "~N turns left" (or "17% to auto-compact" when there's plenty of room).
- **What's in context**: what is taking up the space (your conversation, tools, CLAUDE.md, MCP servers…), each with a small bar. If an MCP server takes a lot of space and was never used, it's pointed out, with a **Disable…** button that copies the `/mcp` command for you.
- **Prompt cache**: Claude Code reuses recent context cheaply for a short while (5 minutes or 1 hour). This shows whether it's still warm and how long until it goes cold. Replying while it's warm is cheaper and faster.
- **Subagents**: helpers Claude sent off to do work (like searching the code). Each shows how much it read and how little it brought back, which is space saved in your main conversation. **View** opens what it did.
- **Usage**: your plan's 5-hour and weekly limits with reset times, and **API cost**, what this session would have cost at API prices.
- **Plan compact**: opens the planner.

### 3. Compact on your terms

**Plan compact** opens the **compact planner**:

1. **Keep** and **Drop**: tick what the summary must keep (current task and plan, files edited, decisions made, your preferences…) and what it can throw away (old search results, large file dumps…). The choices are suggested from your own session.
2. The box shows the exact `/compact` instruction that will be used. **Copy** (next to the title) puts it on your clipboard. You can **add an instruction** of your own.
3. **Estimated after compact** shows the size before → after. **Best moment** tells you if now is a good time (for example, Claude isn't busy and the cache is warm).
4. **Compact now** asks once ("Confirm compact"), then compacts with your instructions. If Claude is in the middle of a reply, it waits. **‹ Back** returns to the forecast.

Under it, **Next move** may suggest up to three habits that save room, each only when it applies. For example: hand broad code searches to an Explore subagent, move a long CLAUDE.md into a skill, or start a new session when the topic changes.

## Commands

| Type this | What happens |
| --- | --- |
| `/weather` | Show the band above the prompt |
| `/weather forecast` | Open or close the forecast pane |
| `/weather auto` | The default: weather in the footer while calm, band when it matters |
| `/weather mini` | Always keep the weather small, in the footer |
| `/weather hide` | Hide it; `/weather` brings it back |

If another plugin already uses `/weather`, the command is `/context-forecast` instead (for example `/context-forecast forecast`).

On the terminal, a few keys work when the band or pane has focus: `f` forecast, `m` minimize, `c` plan compact, `b` back.

## Good to know

- Numbers with `~` are estimates.
- The turn forecast is based on how much each recent turn added (the middle value of the last 8 turns, so one huge file read doesn't throw it off). Until it has seen a few turns, it says "Measuring growth".
- Sections with nothing to show (no subagents, no plan limits, unknown cache time) are hidden.

## Privacy: what it reads, runs and sends

Everything runs on your computer. Context Forecast **sends nothing anywhere**: no network requests, no bundled MCP server, no model calls.

- **Reads session usage**: the context size, window, rate-limit percentages and session cost Claude Code reports for the current session (`$.session.usage`).
- **Reads no environment variables and no credentials.** The transcript's location is the `transcript_path` Claude Code itself hands to its hooks; the mod's `classic.SessionStart`, `classic.UserPromptSubmit` and `classic.Stop` hooks only note that path and pass each event on unchanged.
- **Reads the current session's transcript file** (`$.fs.read`) when a session starts and after each turn, for the token history and the prompt-cache lifetime (files over 4 MiB are skipped). Only token counts, cache figures, request ids and timestamps are used. Subagent records in the session's `subagents/` folder are read for agent type and token counts.
- **Reads the conversation** (`$.session.messages()`) after each turn, to count tool calls, edited files, searches, large results and test failures, and to notice a topic change. Only counts and sizes are kept; message text and file paths are never stored or shown.
- **Runs one slash command, `/compact`, and only when you press Compact now.** It first asks Claude Code to compact directly (`$.session.compact`); where that isn't available (the desktop app and other SDK hosts) it runs `/compact <the instructions shown in the planner>` through `$.command.run`, exactly as if you had typed it. It runs no other command.
- **Writes to your clipboard only when you press a button**: **Copy** (the `/compact` command) and **Disable…** (`/mcp`). The clipboard stays on your computer.
- **Opens a subagent's transcript in Claude Code's own viewer** (`$.ui.view({ agentId })`) when you press **View**. That only shows a local record inside the app; nothing is sent anywhere.
- **Watches compactions** with a `session.compact` hook: it lets every compaction (yours, Claude Code's automatic one, or one it started) run unchanged, then restarts the forecast from the new size.
- **Runs no programs**: no processes, no shell commands.
- **Registers only its own `/weather` command** (or `/context-forecast` if `/weather` is taken). It doesn't touch permissions, agents, settings or Remote Control.
- **Keeps a little state** (recent token samples, last reading, cache and subagent counts, planner choices, display mode) in Claude Code's own plugin state.

See [PRIVACY.md](PRIVACY.md).

## For the curious: where each number comes from

| Figure | Source |
| --- | --- |
| Used / window | `$.session.usage()` → `context.tokens`, `context.window` (the status line's figures) |
| Model, auto-compact threshold, bar length, reserve | `$.session.usage({ breakdown: 'summary' })` → `breakdown.model`, `autoCompactThreshold`, `rawMaxTokens`, the `buffer` category |
| What's in context | `breakdown.categories`, folded into groups |
| MCP space per server | `breakdown.mcpTools` by `serverName` |
| MCP calls | `mcp__<server>__*` tool calls, counted live (`tool.call`) and in `$.session.messages()` |
| CLAUDE.md size | `breakdown.memoryFiles` named `CLAUDE.md` |
| Growth, turns left | each main-thread request's usage (`turn.step`) and turn ends (`session.measure`); history rebuilt from the transcript |
| Cache read %, written last turn | last request's `cache_read/creation_input_tokens` (`turn.step`, `turn.complete`) |
| Cache lifetime | the transcript's `usage.cache_creation.ephemeral_1h/5m_input_tokens`; for a transcript over 4 MiB, the cache's behaviour across an idle gap (read after >5 min idle → 1h; re-written inside the hour → 5m) |
| Cache countdown | time of the last main-thread response + lifetime |
| Subagents | `$.agent.list()` (type, description); each agent's `turn.step` usage (its largest context); its `turn.complete` answer (≈ characters ÷ 4); earlier runs from the session's `subagents/agent-*.meta.json` and `.jsonl` |
| Usage limits | `usage.rateLimits` (`five_hour`, `seven_day`: `percentUsed`, `resetsAt`) |
| API cost | `usage.cost.usd` |
| Planner choices, next-move tips | `$.session.messages()` since the last compaction: tool names, inputs and result sizes |
| After-compact estimate | ≈ non-message context + a summary of about a tenth of the messages (3k–20k) + anything kept word for word |

## Development

```
claude plugin validate .      # manifest + hooks
claude plugin test .          # unit and UI tests
./scripts/preflight.sh        # everything the directory's checks look at
```

Source: `hooks/forecast.ts` (weather, growth, turns left), `hooks/band.ts` (the band above the prompt), `hooks/insights.ts` (context groups, MCP, planner, next-move tips), `hooks/panel.ts` (the pane's figures), `hooks/pane.tsx` (drawing the pane and planner), `hooks/icons.ts` (section icons), `hooks/sky.ts` (animated weather), `hooks/history.ts` (reading the transcript), `hooks/fixtures.ts` (preview data), `hooks/register.tsx` (events, band, footer and `/weather`).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Section icons are from [Lucide](https://lucide.dev) (ISC).

Context Forecast is derived from the `token-weather` sample mod in [anthropics/claude-code-playground](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/token-weather) (Apache-2.0). It is an independent project, not an Anthropic product.
