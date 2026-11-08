import type { Level } from './forecast'

// Animated weather for each condition. The desktop draws it as an SVG image
// (transparent, its CSS animations running, stopped under reduced motion);
// the terminal repaints a three-cell Raster from a timer.

const STYLE =
  '<style>' +
  '@keyframes spin{to{transform:rotate(360deg)}}' +
  '@keyframes breathe{0%,100%{transform:scale(.86);opacity:.25}50%{transform:scale(1.08);opacity:.5}}' +
  '@keyframes twinkle{0%,100%{transform:scale(0);opacity:0}45%,55%{transform:scale(1);opacity:1}}' +
  '@keyframes drift{0%,100%{transform:translateX(-1.4px)}50%{transform:translateX(1.6px)}}' +
  '@keyframes driftBack{0%,100%{transform:translateX(1.6px)}50%{transform:translateX(-1.8px)}}' +
  '@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-.8px)}}' +
  '@keyframes fall{0%{transform:translate(1px,-4px);opacity:0}20%{opacity:1}80%{opacity:1}100%{transform:translate(-1.4px,6px);opacity:0}}' +
  '@keyframes splash{0%,72%{transform:scale(.2);opacity:0}82%{opacity:.45}100%{transform:scale(1.3);opacity:0}}' +
  '@keyframes bolt{0%,70%,100%{opacity:.35}72%,78%{opacity:1}75%{opacity:.5}}' +
  '@keyframes lit{0%,70%,100%{opacity:0}72%,78%{opacity:.55}75%{opacity:.15}}' +
  '@keyframes draw{0%{stroke-dashoffset:40;opacity:0}12%{opacity:1}45%,85%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}' +
  '@keyframes partL{0%,100%{transform:translateX(0)}50%{transform:translateX(-2.2px)}}' +
  '@keyframes partR{0%,100%{transform:translateX(0)}50%{transform:translateX(2.2px)}}' +
  '.c{transform-box:fill-box;transform-origin:center}' +
  '.spin{animation:spin 24s linear infinite}' +
  '.breathe{animation:breathe 3.6s ease-in-out infinite}' +
  '.twinkle{animation:twinkle 2.8s ease-in-out infinite}' +
  '.drift{animation:drift 6s ease-in-out infinite}' +
  '.driftBack{animation:driftBack 8s ease-in-out infinite}' +
  '.bob{animation:bob 3s ease-in-out infinite}' +
  '.fall{animation:fall 1.15s linear infinite}' +
  '.splash{animation:splash 1.15s linear infinite}' +
  '.bolt{animation:bolt 3.4s linear infinite}' +
  '.lit{animation:lit 3.4s linear infinite}' +
  '.draw{stroke-dasharray:40;animation:draw 5s ease-in-out infinite}' +
  '.partL{animation:partL 5s ease-in-out infinite}' +
  '.partR{animation:partR 5s ease-in-out infinite}' +
  '.draw,.twinkle,.fall,.splash{animation-fill-mode:both}' +
  '@media (prefers-reduced-motion:reduce){*{animation:none!important}.fall,.bolt{opacity:1}.draw{stroke-dashoffset:0}}' +
  '</style>'

const DEFS =
  '<defs>' +
  '<radialGradient id="sun" cx=".42" cy=".38" r=".7"><stop offset="0" stop-color="#ffe9a0"/><stop offset=".55" stop-color="#ffc533"/><stop offset="1" stop-color="#f29b00"/></radialGradient>' +
  '<radialGradient id="halo"><stop offset="0" stop-color="#ffc533" stop-opacity=".9"/><stop offset="1" stop-color="#ffc533" stop-opacity="0"/></radialGradient>' +
  '<linearGradient id="cloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f6f9"/><stop offset="1" stop-color="#b4bcc9"/></linearGradient>' +
  '<linearGradient id="cloudBack" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9dee6"/><stop offset="1" stop-color="#99a3b3"/></linearGradient>' +
  '<linearGradient id="rainCloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cdd3dc"/><stop offset="1" stop-color="#8590a1"/></linearGradient>' +
  '<linearGradient id="stormCloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d96a6"/><stop offset="1" stop-color="#454d5b"/></linearGradient>' +
  '<linearGradient id="drop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7db8ff" stop-opacity=".2"/><stop offset="1" stop-color="#3a8ef0"/></linearGradient>' +
  '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.1" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
  '</defs>'

const CLOUD_PATH = 'M4.2 10H15.8A4.1 4.1 0 0 0 15.8 1.9A5.9 5.9 0 0 0 4.9 3.2A3.5 3.5 0 0 0 4.2 10Z'

// A cloud 20 wide and 10 tall at (x, y); s scales it.
function cloud(x: number, y: number, s: number, fill: string, cls: string): string {
  return `<g class="c ${cls}"><path transform="translate(${x} ${y}) scale(${s})" fill="url(#${fill})" d="${CLOUD_PATH}"/></g>`
}

function sun(cx: number, cy: number, r: number): string {
  const rays: string[] = []
  for (let i = 0; i < 12; i += 1) {
    const a = (i * Math.PI) / 6
    const isLong = i % 2 === 0
    const r1 = r + 1.8
    const r2 = r + (isLong ? 4.6 : 3.2)
    rays.push(
      `<line x1="${(cx + Math.cos(a) * r1).toFixed(2)}" y1="${(cy + Math.sin(a) * r1).toFixed(2)}" ` +
        `x2="${(cx + Math.cos(a) * r2).toFixed(2)}" y2="${(cy + Math.sin(a) * r2).toFixed(2)}" stroke-width="${isLong ? 1.7 : 1.2}"/>`,
    )
  }
  return (
    `<circle class="c breathe" cx="${cx}" cy="${cy}" r="${r + 5}" fill="url(#halo)"/>` +
    `<g class="c spin" stroke="#ffbf2e" stroke-linecap="round">${rays.join('')}</g>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#sun)"/>`
  )
}

function sparkle(x: number, y: number, s: number, delay: number): string {
  return (
    `<path class="c twinkle" style="animation-delay:${delay}s" fill="#fff3c4" ` +
    `d="M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z"/>`
  )
}

function rain(xs: readonly number[], y: number, hasSplash: boolean): string {
  return xs
    .map((x, i) => {
      const delay = ((i * 0.43) % 1.15).toFixed(2)
      const dur = (1 + (i % 3) * 0.12).toFixed(2)
      const timing = `animation-delay:${delay}s;animation-duration:${dur}s`
      const line = `<line class="fall" style="${timing}" x1="${x}" y1="${y}" x2="${x - 1}" y2="${y + 4}" stroke="url(#drop)" stroke-width="1.5" stroke-linecap="round"/>`
      const splash = hasSplash && i % 2 === 0
        ? `<ellipse class="c splash" style="${timing}" cx="${x - 1.6}" cy="${y + 11}" rx="1.2" ry=".4" fill="none" stroke="#5aa2f5" stroke-width=".5"/>`
        : ''
      return line + splash
    })
    .join('')
}

// The drawing of a condition on a 32-unit square, for skySvg or a parent SVG.
export function skyBody(level: Level): string {
  switch (level.art) {
    case 0:
      return sun(16, 16, 6.2) + sparkle(26, 7, 1.8, 0) + sparkle(6, 25, 1.4, 1.2) + sparkle(27, 24, 1.2, 2)
    case 1:
      return sun(12, 12, 4.8) + cloud(20, 13, 0.55, 'cloudBack', 'driftBack') + cloud(9, 16, 0.95, 'cloud', 'drift')
    case 2:
      return cloud(2, 7, 0.75, 'cloudBack', 'driftBack') + cloud(17, 9, 0.6, 'cloudBack', 'drift') + cloud(6, 13, 1.05, 'cloud', 'drift')
    case 3:
      return `<g class="c bob">${cloud(5, 5, 1.1, 'rainCloud', 'drift')}</g>` + rain([10, 14.5, 19, 23.5, 12.5, 21], 18, true)
    case 4:
      return (
        `<g class="c bob">${cloud(4, 3, 1.2, 'stormCloud', 'drift')}` +
        `<path class="lit" transform="translate(4 3) scale(1.2)" fill="#fff6d0" d="${CLOUD_PATH}"/></g>` +
        rain([8, 12, 22, 26], 17, false) +
        '<polygon class="bolt" filter="url(#glow)" fill="#ffd43b" points="17.6,14.5 12.6,22.6 16.2,22.6 14.3,29.5 21.4,19.8 17.6,19.8 20,14.5"/>'
      )
    default:
      return (
        '<g fill="none" stroke-width="2" stroke-linecap="round">' +
        '<path class="draw" d="M3.5 24A12.5 12.5 0 0 1 28.5 24" stroke="#ef5350"/>' +
        '<path class="draw" style="animation-delay:.15s" d="M6.3 24A9.7 9.7 0 0 1 25.7 24" stroke="#ffb300"/>' +
        '<path class="draw" style="animation-delay:.3s" d="M9.1 24A6.9 6.9 0 0 1 22.9 24" stroke="#43a047"/>' +
        '<path class="draw" style="animation-delay:.45s" d="M11.9 24A4.1 4.1 0 0 1 20.1 24" stroke="#1e88e5"/>' +
        '</g>' +
        cloud(-1, 18, 0.62, 'cloud', 'partL') +
        cloud(20.5, 18, 0.62, 'cloud', 'partR') +
        sparkle(26, 8, 1.4, 0.6)
      )
  }
}

export function skySvg(level: Level, size: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" style="color-scheme:light dark">` +
    `${STYLE}${DEFS}${skyBody(level)}</svg>`
  )
}

// What a parent SVG carries once to nest several skyBody drawings.
export const SKY_STYLE = STYLE
export const SKY_DEFS = DEFS

// ---- the terminal's three cells ----------------------------------------------

type Cell = [glyph: string, color: number]
const BLANK: Cell = [' ', 0x01000000]
const sunC = (c: number): Cell => ['☼', c]
const cloudC: Cell = ['☁', 0xb4bcc9]
const darkC: Cell = ['☁', 0x8d96a6]
const drop: Cell = ['╷', 0x3a8ef0]
const bolt: Cell = ['ϟ', 0xffd43b]
const SUN_PULSE = [0xf29b00, 0xffc533, 0xffe9a0, 0xffc533]
const RAINBOW = [0xef5350, 0xffb300, 0x43a047, 0x1e88e5]

function frame(level: Level, n: number): Cell[] {
  switch (level.art) {
    case 0:
      return [sunC(SUN_PULSE[n % 4]!), n % 4 === 2 ? ['·', 0xfff3c4] : BLANK, BLANK]
    case 1:
      return [sunC(SUN_PULSE[n % 4]!), n % 4 < 2 ? cloudC : BLANK, n % 4 < 2 ? BLANK : cloudC]
    case 2:
      return [[cloudC, BLANK, cloudC], [BLANK, cloudC, BLANK], [cloudC, BLANK, cloudC], [BLANK, cloudC, cloudC]][n % 4]!
    case 3:
      return [[cloudC, drop, BLANK], [cloudC, BLANK, drop], [cloudC, drop, drop], [cloudC, BLANK, BLANK]][n % 4]!
    case 4:
      return [[darkC, bolt, drop], [darkC, BLANK, drop], [darkC, drop, BLANK], [darkC, BLANK, BLANK]][n % 4]!
    default:
      return [0, 1, 2].map(i => ['◠', RAINBOW[(n + i) % 4]!] as Cell)
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += B64[a >> 2]
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : B64[c & 63]
  }
  return out
}

export const SKY_COLUMNS = 3

export function skyCells(level: Level, n: number): string {
  const words: number[] = []
  for (const [glyph, color] of frame(level, n)) words.push(glyph.codePointAt(0)!, color, 0x01000000)
  return base64(new Uint8Array(Uint32Array.from(words).buffer))
}
