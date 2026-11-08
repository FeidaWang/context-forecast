// Section icons, shared with Token Weather for Codex: Lucide (ISC license,
// https://lucide.dev), drawn as 24-unit stroke paths in a tint of their own.

const PATHS = {
  layers:
    '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/>' +
    '<path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/>' +
    '<path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
  database:
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  bot:
    '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/>' +
    '<path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  chart:
    '<path d="M12 16v5"/><path d="M16 14.639V21"/><path d="M20 10.656V21"/>' +
    '<path d="m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15"/><path d="M4 18.463V21"/><path d="M8 14.656V21"/>',
  minimize: '<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
} as const

export type IconName = keyof typeof PATHS

// Each section's tint: mid tones that read on light and dark.
export const ICON_TINT: Record<IconName, string> = {
  layers: '#3987e5',
  database: '#1d9e75',
  bot: '#d39a12',
  chart: '#d97757',
  minimize: '#3987e5',
  info: '#3987e5',
}

export function iconSvg(name: IconName, size = 14, color = ICON_TINT[name]): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`
  )
}
