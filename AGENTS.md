# AGENTS.md

Guidance for agents working on Context Forecast.

## UI

- Avoid unnecessary secondary labels and descriptions, let the layout do the explaining.
- Flat surfaces, 0.5px hairlines between sections, sentence case, two font weights (regular, semibold).
- Numbers in mono. Estimates carry `~`; anything the session cannot report is hidden, not shown as a placeholder.
- The forecast pane is at most 360px of content: 41 cells on desktop, where a pane cell is about 8.8px.
- Bars and dividers stretch to their column (an `Svg` with no `width`, wide markup, `preserveAspectRatio="none"`); never size them from a guessed pixels-per-cell.
- Mono for the digits only; the words around them stay in the body face.
- Toggles (planner chips) never borrow the primary button's look; the primary style is for the one action.
- An action shows where it lands: opening the planner moves the focus to it, so it is never below the fold.
- Nothing looks pressable unless it is (no link-coloured text that does nothing); a toggle's mark means one thing per list.
- Irreversible actions (Compact now) ask once, saying what will happen, before they run.
- The desktop draws the prompt footer's mode slot (`SessionMode`) as its own framed chip around the text drawn there: the frame cannot be removed from a plugin, and a `Client` (no text) is not drawn at all. Keep a plain, dim `Button` there so the label stays pressable.
- Light and dark mode: use theme colours for text; SVG colours must read on both.

## Code

- The desktop Code tab runs Claude Code headless: `$.session.compact` throws there. Compact through it first, then fall back to `$.command.run({ command: 'compact', args })`.
- An `Svg` with an empty `alt` is not drawn on the desktop: always give one.
- `hooks/panel.ts` builds every figure the pane shows; `hooks/pane.tsx` only draws. Debug previews (`hooks/fixtures.ts`) go through the same `buildPanel`.
- Every number must trace to a source listed in the README's "Where each number comes from" table.
- Check with `claude plugin test .` and `claude plugin validate .`.
