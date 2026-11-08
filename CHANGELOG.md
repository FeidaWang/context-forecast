# Changelog

## 0.2.4

- Directory review fixes: the transcript path now comes from Claude Code's own hook input (`transcript_path`), so no environment variable is read; no `h` names in JSX files; `displayName` dropped from plugin.json.
- README and PRIVACY.md say which slash command the mod runs (`/compact`, only on Compact now), what it writes to the clipboard, what View opens, and what its `session.compact` and classic hooks do.

## 0.2.3

- README rewritten for newcomers, with a Simplified Chinese README (README.zh-CN.md); PRIVACY.md notes the desktop `/compact` path.

## 0.2.2

- Planner footer mirrors the main card: ‹ Back at the bottom left (as Close), Compact now at the right; Copy moved beside the planner's title; toggles one a line; the folded forecast above keeps only header, hero and bar; the confirm button reads "Confirm compact" (the size is in the estimate row above).
- Session cost reads "API cost ~$1.23".

## 0.2.1

- Band redesign: one line (condition · turns until auto-compact, pressable), gauge with a neutral threshold mark until Rain, limits only past 50% in a fixed order, Plan compact in Rain and Storm, "Compacted · before → after" after a compaction; cost moved to the pane; Cloudy is now calm blue.
- Band refinements: the condition keeps its colour, the line reads "~N turns until auto-compact ›" (or "46% to auto-compact" with room to spare), the size sits beside a gauge with no unlabelled projection, Minimize/Hide at full strength; new default `auto` folds the band into the footer while calm.
- Footer weather is a plain, dim button (no extra padding or offset) that opens the band.
- Live-data fixes: cache lifetime inferred when the transcript is too large to read; subagent records read on their own; model shown as "Opus 5.5" and 1M windows as "1M"; the hero matches the band ("55% to auto-compact"); "533k used" under the bar; app-provided MCP servers have no Disable button; resets past a day read "1d 0h".
- Pane sections carry tinted Lucide icons (shared with the Codex edition); each context category shows a share bar; cache hit rate is coloured; subagent values no longer wrap; the planner's way back is "‹ Back to forecast" at its top-left.
- Compact now works in the desktop app: where direct compaction is not available (headless/SDK hosts) it runs `/compact` with the planned instructions.
- Subagent rows: the type is plain text aligned with the other labels; each row has a View button at the right that opens its transcript.
- Section icons: Prompt cache is a database, Subagents a bot.
- The model name in the pane header is in Claude orange; the Usage icon and bars are orange too, turning red from 90%.

## 0.2.0

- Four conditions by share of the auto-compact threshold: Clear (<30%), Cloudy (30–60%), Rain (60–85%), Storm (85%+); Clearing after a compaction.
- Growth per turn is now the median of the last ≤8 deltas since the last compaction, negative deltas excluded; over 99 turns reads "Plenty of room".
- New forecast pane (≈360px): header, turns-left hero, segmented context bar with the compaction reserve, what's in context (with idle MCP server flag), prompt cache countdown, subagents, limits and API-equivalent cost.
- Compact planner: Keep/Drop chips derived from the session, live `/compact` preview, after-compact estimate, best moment, Copy command and Compact now.
- Next-move suggestions (Explore subagent, CLAUDE.md into a skill, new session after a topic shift), at most three, each only when its rule fires.
- `/weather debug`: preview Clear, Cloudy, Storm and the planner with fixture data.
- A compaction (any trigger) restarts the forecast from the size it left.
- Pane follows the new two-card design: main card (header, hero and bar as one block, context, cache, subagents, limits, compact) and planner card (chips, instructions, estimate, actions, next move); secondary labels removed (see AGENTS.md).
- Interaction: the planner opens in view (focus moves to it; the main card folds on a narrow pane); toggles read ☑/☒/☐; Compact now asks once; add your own instruction; Disable… copies `/mcp`; subagent rows open their transcript; calmer cache countdown; debug picker.
- `/weather debug <state>` jumps to a preview; where another plugin holds `/weather`, the command registers as `/context-forecast`.

## 0.1.5

- Add privacy policy, support, and documentation links to the manifest.

## 0.1.4

- Stop starting a process: oversized transcripts (over 4 MiB) are no longer read with `tail`; history backfill is skipped for them.
- Rename the internal `fmtTokens` helper to `fmtCount`.

## 0.1.3

- Restore the `types` manifest field (needed to declare plugin state).
- Write `register` as a function declaration, give the API type a non-`$` name, and move timer and refresh logic into top-level helpers so the directory's analyzer can follow every `$` use.

## 0.1.2

- Renamed from Token Weather to Context Forecast (plugin id `context-forecast`).
- License is Apache-2.0, matching the upstream sample this mod derives from; added NOTICE with attribution.

## 0.1.1

- Add listing icon; remove the unused `types` manifest field.
- README now states exactly what the mod reads, runs, and sends.

## 0.1.0

- Weather band above the prompt: condition (Clear, Fair, Cloudy, Showers, Storm, Clearing), turns left to compaction, per-turn growth, rate-limit and cost readouts.
- `/weather forecast` pane with a five-turn outlook, history chart, context breakdown and weather scale.
- `/weather mini` and `/weather hide` to minimize or hide the band; bare `/weather` brings it back.
- History is rebuilt from the session transcript when a session is resumed.
- Works on the terminal and desktop surfaces.
