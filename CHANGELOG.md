# Changelog

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
