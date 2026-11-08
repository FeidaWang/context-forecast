# Privacy

Context Forecast runs entirely on your machine.

- **Reads:** the context-usage figures Claude Code reports for the current session (tokens, window size, rate-limit percentages, session cost), and the current session's own transcript file under `$CLAUDE_CONFIG_DIR` (default `~/.claude/projects/...`), read locally for the token history and the prompt-cache lifetime, plus the session's subagent records. The conversation itself (`$.session.messages()`) is read to count tool calls, edited files, searches and large results for the compact planner and suggestions. Only counts, sizes and timestamps are kept; message text and file paths are never stored or displayed.
- **Stores:** a small in-memory/session state (recent token samples, last reading, cache and subagent counts, planner choices, display mode). Nothing is written outside Claude Code's own plugin state.
- **Acts:** compacts the conversation only when you press Compact now, and writes the `/compact` command to your clipboard only when you press Copy command.
- **Sends:** nothing. The plugin makes no network requests, bundles no MCP server, and does not read credentials or environment secrets.
- **Age:** the plugin is not directed at people under 18 and collects no personal data.

Questions: founder@rsiagent.app
