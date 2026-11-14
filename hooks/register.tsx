import { atom, read, update } from 'claude-code'
import type { Register, SessionMeasureInput, SessionUsage, ThemeSetArgs } from 'claude-code'

import type { Flight, MissionLog, Telemetry } from '../types'
import { makeColors } from './make-colors.js'

// Flight deck at orbital night: gunmetal panels, CRT phosphor, annunciator lamps.
const { theme, problems } = makeColors({
  label: 'Shuttle cockpit',
  only: 'dark',
  roles: { accent: '#46c8e8', danger: '#ff4f3f', success: '#5fe08a', warning: '#ffb02e', pro: '#b48cff' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0c1014',
        'surface-1': '#131920',
        'surface-2': '#182029',
        'surface-3': '#1c252f',
        'text-primary': '#e8eef1',
        'text-secondary': '#bcc8cf',
        'text-muted': '#93a1aa',
      },
    },
  },
})

// ---- telemetry -------------------------------------------------------------
const EMPTY: Telemetry = {
  contextPercent: null,
  contextTokens: null,
  contextWindow: 0,
  costUsd: null,
  fiveHour: null,
  sevenDay: null,
  startedAt: null,
  measuredAt: null,
}
const telemetry = atom({ plugin: 'shuttle-cockpit', key: 'telemetry' } as const, EMPTY)
const NO_FLIGHT: Flight = { model: null, effort: null }
const flight = atom({ plugin: 'shuttle-cockpit', key: 'flight' } as const, NO_FLIGHT)
const NO_LOG: MissionLog = { turns: 0, toolCalls: 0 }
const missionLog = atom({ plugin: 'shuttle-cockpit', key: 'log' } as const, NO_LOG)
// Tool calls since the last measurement; folded into the log once per turn so
// the backdrop redraws per turn, not per tool call.
let pendingCalls = 0

// "claude-opus-5-5" -> "OPUS 5.5"; anything else is shown as given, uppercased.
const modelName = (id: string | null) => {
  if (id === null) {
    return 'STANDBY'
  }
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:\b|$)/i.exec(id.replace(/\[.*\]$/, ''))
  return (m ? `${m[1]} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : id).toUpperCase().slice(0, 20)
}

const toTelemetry = (u: SessionMeasureInput | SessionUsage, startedAt: number | null, now: number): Telemetry => ({
  contextPercent: u.context.percent ?? null,
  contextTokens: u.context.tokens ?? null,
  contextWindow: u.context.window,
  costUsd: u.cost?.usd ?? null,
  fiveHour: u.rateLimits.find(r => r.kind === 'five_hour')?.percentUsed ?? null,
  sevenDay: u.rateLimits.find(r => r.kind === 'seven_day')?.percentUsed ?? null,
  startedAt,
  measuredAt: now,
})

const kTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1000)}K`)
const pad = (n: number) => String(n).padStart(2, '0')
// Mission elapsed time, as of the last measurement.
const met = (t: Telemetry) => {
  if (t.startedAt === null || t.measuredAt === null) {
    return '--:--:--'
  }
  const s = Math.max(0, Math.floor((t.measuredAt - t.startedAt) / 1000))
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Phosphor turns amber, then red, as a gauge fills.
const gaugeColor = (p: number | null) =>
  p === null ? '#5fe08a' : p >= 90 ? '#ff4f3f' : p >= 70 ? '#ffb02e' : '#5fe08a'

// ---- the scene -------------------------------------------------------------
// Deterministic layout so the hardware is identical every load and redraw.
let seed = 7
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647

const STARS = Array.from({ length: 150 }, (_, i) => {
  const x = (rand() * 1600).toFixed(0)
  const y = (rand() * 560).toFixed(0)
  const r = (rand() * 1.4 + 0.4).toFixed(1)
  const cls = i % 5 === 0 ? ` class="tw t${i % 3}"` : ''
  return `<circle cx="${x}" cy="${y}" r="${r}"${cls}/>`
}).join('')

const switches = (x0: number, y0: number, n: number) => {
  let out = ''
  for (let i = 0; i < n; i++) {
    const x = x0 + i * 34
    const up = rand() < 0.5
    out += `<circle cx="${x}" cy="${y0}" r="9" fill="#2a333d" stroke="#46525e" stroke-width="2"/>`
    out += `<rect x="${x - 3}" y="${up ? y0 - 22 : y0}" width="6" height="22" rx="3" fill="#aab4bc"/>`
  }
  return out
}

// Readout panels where the lamp grids were: the model on the left, effort as
// a five-step throttle gauge on the right.
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

type At = readonly [number, number]

const readout = ([x, y]: At, label: string, value: string, body: string) =>
  `<g transform="translate(${x} ${y})" font-family="monospace">` +
  `<rect width="360" height="104" rx="8" fill="#060a0c" stroke="#2b343e" stroke-width="5"/>` +
  `<text x="16" y="24" fill="#46c8e8" font-size="12" opacity=".85">${esc(label)}</text>` +
  `<text x="16" y="62" fill="#ffb02e" font-size="30" font-weight="700" class="glow">${esc(value)}</text>` +
  body +
  `<rect x="3" y="3" width="354" height="98" rx="6" fill="url(#scan)" opacity=".35"/>` +
  `</g>`

const flightPanels = (f: Flight, left: At, right: At) => {
  const level = typeof f.effort === 'string' ? EFFORTS.indexOf(f.effort as (typeof EFFORTS)[number]) : -1
  const effortText = f.effort === null ? 'DEFAULT' : String(f.effort).toUpperCase()
  const segs = EFFORTS.map((name, i) => {
    const on = i <= level
    const fill = on ? (i >= 3 ? '#ff7a3f' : '#ffb02e') : '#1d2a33'
    return (
      `<rect x="${16 + i * 66}" y="76" width="58" height="12" rx="2" fill="${fill}"/>` +
      `<text x="${45 + i * 66}" y="100" fill="#5fe08a" font-size="9" text-anchor="middle" opacity="${on ? '.85' : '.4'}">${name.toUpperCase()}</text>`
    )
  }).join('')
  const modelFoot = `<text x="16" y="90" fill="#5fe08a" font-size="11" opacity=".7">${esc(f.model ?? 'AWAITING FIRST BURN')}</text>`
  return readout(left, 'FLIGHT COMPUTER · MODEL', modelName(f.model), modelFoot) +
    readout(right, 'THRUST · EFFORT', effortText, segs)
}

const SWITCHES = switches(60, 940, 11) + switches(1200, 940, 11)

// A CRT monitor: a label, a big reading, a bar gauge and a footer line.
const crt = ([x, y]: At, label: string, value: string, percent: number | null, foot: string) => {
  const c = gaugeColor(percent)
  const w = percent === null ? 0 : Math.min(100, Math.max(0, percent)) * 1.62
  return (
    `<g transform="translate(${x} ${y})" font-family="monospace">` +
    `<rect width="190" height="130" rx="10" fill="#060a0c" stroke="#2b343e" stroke-width="6"/>` +
    `<path d="M12 36 H178" stroke="#1d3a28" stroke-width="1"/>` +
    `<text x="14" y="26" fill="#46c8e8" font-size="12" opacity=".85">${esc(label)}</text>` +
    `<text x="14" y="72" fill="${c}" font-size="28" font-weight="700" class="glow">${esc(value)}</text>` +
    `<rect x="14" y="84" width="162" height="10" rx="2" fill="#0f1a14" stroke="#1d3a28"/>` +
    `<rect x="14" y="84" width="${w.toFixed(1)}" height="10" rx="2" fill="${c}" opacity=".85"/>` +
    `<text x="14" y="116" fill="#5fe08a" font-size="11" opacity=".7">${esc(foot)}</text>` +
    `<rect x="3" y="3" width="184" height="124" rx="8" fill="url(#scan)" opacity=".35"/>` +
    `</g>`
  )
}

const pct = (p: number | null) => (p === null ? 'NO DATA' : `${p < 10 ? p.toFixed(1) : Math.round(p)}%`)

const screens = (t: Telemetry, log: MissionLog, [a, b, c, d]: readonly [At, At, At, At]) => {
  const ctxFoot =
    t.contextTokens === null
      ? `WINDOW ${t.contextWindow ? kTok(t.contextWindow) : '--'}`
      : `${kTok(t.contextTokens)} / ${kTok(t.contextWindow)} TOK`
  const cost = t.costUsd === null ? 'NO DATA' : `$${t.costUsd.toFixed(2)}`
  const limitFoot = (p: number | null) => (p === null ? 'NO READING' : 'USED THIS WINDOW')
  return (
    crt(a, 'CONTEXT', pct(t.contextPercent), t.contextPercent, ctxFoot) +
    crt(b, 'SESSION COST', cost, null, `MET ${met(t)}`) +
    crt(c, 'MISSION LOG', `${log.turns} ${log.turns === 1 ? 'TURN' : 'TURNS'}`, null, `${log.toolCalls} TOOL CALLS`) +
    crt(d, '7-DAY LIMIT', pct(t.sevenDay), t.sevenDay, limitFoot(t.sevenDay))
  )
}

// MASTER ALARM lights past 90% on any gauge; CAUTION past 70%.
const peak = (t: Telemetry) => Math.max(t.contextPercent ?? 0, t.sevenDay ?? 0)

const lamp = ([x, y]: At, attrs: string, fill: string, ink: string, word: string) =>
  `<g ${attrs}>` +
  `<rect x="${x}" y="${y}" width="70" height="30" rx="4" fill="${fill}"/>` +
  `<text x="${x + 35}" y="${y + 20}" fill="${ink}" font-family="monospace" font-size="11" font-weight="700" text-anchor="middle">${word}</text>` +
  `</g>`

const annunciators = (t: Telemetry, masterAt: At, cautionAt: At) => {
  const p = peak(t)
  const master = p >= 90 ? 'class="master"' : 'opacity=".18"'
  const caution = p >= 70 ? 'opacity=".9"' : 'opacity=".18"'
  return lamp(masterAt, master, '#ff4f3f', '#1a0705', 'MASTER') + lamp(cautionAt, caution, '#ffb02e', '#1a1205', 'CAUTION')
}

// The instrument panel, in two layouts. Each sits in its own nested <svg> that
// scales to fit the width ("meet") and hugs the bottom edge, so no gauge is
// ever cropped. The scene's @media rules show the one that fits the box.
//
// Wide: two gauge banks, one on each side of the chat column, which sits over
// the middle (about x 425 to 1180 here). Each bank: two screens, the alarm
// lamp above them, a readout beneath.
const wideConsole = (t: Telemetry, f: Flight, log: MissionLog) =>
  `<g class="wide">` +
  // a full-width deck behind, so the panel reaches both edges at any size
  `<rect y="60%" width="100%" height="40%" fill="#0b0f13"/>` +
  // the console, sized by the window's height so it stays inside the area
  // right of the sidebar
  `<svg y="60%" width="100%" height="40%" viewBox="0 590 1600 410" preserveAspectRatio="xMidYMax meet" overflow="visible">` +
  `<path d="M-400 600 L-400 560 Q800 470 2000 560 L2000 600 Z" fill="#0e1317"/>` +
  `<rect x="-400" y="590" width="2400" height="410" fill="url(#panel)"/>` +
  `<path d="M-400 596 Q800 506 2000 596" fill="none" stroke="#2a333c" stroke-width="3"/>` +
  SWITCHES +
  screens(t, log, [[10, 640], [215, 640], [1195, 640], [1400, 640]]) +
  flightPanels(f, [10, 790], [1230, 790]) +
  annunciators(t, [172, 600], [1357, 600]) +
  `</svg>` +
  `</g>`

// Compact: the four screens side by side, the readouts below (sidebar open,
// a split view, a phone).
const compactConsole = (t: Telemetry, f: Flight, log: MissionLog) =>
  `<svg class="compact" width="100%" height="100%" viewBox="0 0 820 312" preserveAspectRatio="xMidYMax meet">` +
  `<rect width="820" height="312" rx="14" fill="url(#panel)"/>` +
  `<path d="M14 1 H806" stroke="#2a333c" stroke-width="3"/>` +
  annunciators(t, [290, 8], [460, 8]) +
  screens(t, log, [[20, 46], [215, 46], [410, 46], [605, 46]]) +
  flightPanels(f, [26, 192], [434, 192]) +
  `</svg>`

const WINDOWS = [
  'M90 90 L470 60 L500 520 L60 560 Z',
  'M540 52 L1060 52 L1040 500 L560 500 Z',
  'M1130 60 L1510 90 L1540 560 L1100 520 Z',
]
const paths = WINDOWS.map(d => `<path d="${d}"/>`).join('')

// The Claude Code mascot in a space suit: a blocky terracotta critter in a
// bubble helmet with a backpack and a blinking antenna. Drawn centered on 0,0;
// every ~75 s it drifts past the windows, slowly tumbling, waving one arm.
const ASTRONAUT =
  `<g class="astro"><g class="bob"><g transform="scale(1.4)">` +
  // thruster puffs behind it
  `<g class="puff" fill="#cfe6ff"><circle cx="-112" cy="30" r="9"/><circle cx="-134" cy="40" r="6"/><circle cx="-150" cy="48" r="4"/></g>` +
  // backpack and antenna
  `<rect x="-46" y="-58" width="92" height="22" rx="6" fill="#aeb8c1" stroke="#7d8892" stroke-width="3"/>` +
  `<path d="M28 -58 V-104" stroke="#aeb8c1" stroke-width="4"/>` +
  `<circle class="beacon" cx="28" cy="-108" r="6" fill="#ff4f3f"/>` +
  // body, arms, legs, eyes
  `<rect x="-54" y="-36" width="108" height="60" fill="#d97757"/>` +
  `<rect x="-72" y="-12" width="18" height="18" fill="#d97757"/>` +
  `<g class="wave"><rect x="54" y="-12" width="18" height="18" fill="#d97757"/></g>` +
  `<g fill="#d97757"><rect x="-42" y="24" width="12" height="18"/><rect x="-18" y="24" width="12" height="18"/>` +
  `<rect x="6" y="24" width="12" height="18"/><rect x="30" y="24" width="12" height="18"/></g>` +
  `<g fill="#141414"><rect x="-30" y="-24" width="10" height="18"/><rect x="20" y="-24" width="10" height="18"/></g>` +
  // suit collar and bubble helmet with a highlight
  `<ellipse cx="0" cy="50" rx="66" ry="10" fill="#cfd6dc" stroke="#8d98a2" stroke-width="3"/>` +
  `<circle cx="0" cy="-6" r="92" fill="#bfe9ff" fill-opacity=".1" stroke="#e4f6ff" stroke-opacity=".75" stroke-width="4"/>` +
  `<path d="M-60 -58 A80 80 0 0 1 -14 -92" fill="none" stroke="#ffffff" stroke-opacity=".7" stroke-width="6" stroke-linecap="round"/>` +
  `</g></g></g>`

// The desktop app's sidebar covers the left of the backdrop, and the chat
// column is centered in the space right of it. The app doesn't tell a mod
// whether the sidebar is open, so the cockpit is laid out for it open: the
// whole scene shifts right by half this width (CSS pixels), which puts the
// chat at the cockpit's center; the gap it leaves is under the sidebar.
const SIDEBAR_PX = 300

// The root has no viewBox, so it is exactly the scene's box: the view out the
// windows is cropped art ("slice"), the console is pinned and never cropped.
const scene = (t: Telemetry, f: Flight, log: MissionLog, inset: number) =>`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
<defs>
  <radialGradient id="earth" cx="50%" cy="0%" r="90%">
    <stop offset="0" stop-color="#2c6fa8"/><stop offset=".35" stop-color="#174a78"/>
    <stop offset=".7" stop-color="#0b2540"/><stop offset="1" stop-color="#06121f"/>
  </radialGradient>
  <linearGradient id="limb" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#9fe4ff" stop-opacity="0"/><stop offset=".5" stop-color="#7fd0ff" stop-opacity=".9"/>
    <stop offset="1" stop-color="#3a8fd0" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#1a2128"/><stop offset="1" stop-color="#0b0f13"/>
  </linearGradient>
  <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">
    <rect width="4" height="2" fill="#000"/>
  </pattern>
  <clipPath id="win">${paths}</clipPath>
</defs>
<style>
  .stars circle{fill:#dfe9ff}
  .tw{animation:tw 4s ease-in-out infinite}
  .t1{animation-delay:-1.3s}.t2{animation-delay:-2.6s}
  @keyframes tw{0%,100%{opacity:1}50%{opacity:.25}}
  .drift{animation:drift 240s linear infinite}
  @keyframes drift{from{transform:translateX(0)}to{transform:translateX(-1600px)}}
  .earthg{animation:bob 30s ease-in-out infinite;transform-origin:800px 1400px}
  @keyframes bob{0%,100%{transform:rotate(-1.2deg)}50%{transform:rotate(1.2deg)}}
  .bl{animation:bl 2.4s steps(1) infinite}
  .b1{animation-delay:-.6s}.b2{animation-delay:-1.2s}.b3{animation-delay:-1.8s}
  @keyframes bl{0%{opacity:1}50%{opacity:.15}}
  .glow{filter:drop-shadow(0 0 4px currentColor)}
  .master{animation:master 1.6s ease-in-out infinite}
  @keyframes master{0%,100%{opacity:.35}50%{opacity:1}}
  .astro{opacity:0;animation:astro 40s linear infinite}
  @keyframes astro{
    0%{opacity:1;transform:translate(-200px,300px) rotate(-12deg)}
    62%{opacity:1;transform:translate(1820px,170px) rotate(26deg)}
    62.1%,100%{opacity:0;transform:translate(1820px,170px) rotate(26deg)}}
  .bob{animation:bob2 5s ease-in-out infinite}
  @keyframes bob2{0%,100%{transform:translateY(-14px)}50%{transform:translateY(14px)}}
  .wave{animation:wave 1.4s ease-in-out infinite;transform-box:fill-box;transform-origin:0% 50%}
  @keyframes wave{0%,100%{transform:rotate(0)}50%{transform:rotate(-35deg)}}
  .beacon{animation:bl 1.2s steps(1) infinite}
  .puff{animation:puff 2s ease-out infinite}
  @keyframes puff{0%{opacity:.8}100%{opacity:0}}
  .shift{transform:translateX(${inset / 2}px)}
  @media (max-width: 900px){.shift{transform:none}}
  .compact{display:none}
  @media (max-aspect-ratio: 13/10){.wide{display:none}.compact{display:inline}}
  @media (prefers-reduced-motion: reduce){*{animation:none!important}}
</style>
<rect width="100%" height="100%" fill="#07090c"/>
<g class="shift">
<svg width="100%" height="100%" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
<rect width="1600" height="1000" fill="#07090c"/>
<g clip-path="url(#win)">
  <rect width="1600" height="600" fill="#02040a"/>
  <g class="stars drift">${STARS}<g transform="translate(1600 0)">${STARS}</g></g>
  <g class="earthg">
    <ellipse cx="800" cy="1400" rx="1500" ry="960" fill="url(#earth)"/>
    <ellipse cx="800" cy="1400" rx="1506" ry="966" fill="none" stroke="url(#limb)" stroke-width="14" opacity=".85"/>
    <ellipse cx="800" cy="1400" rx="1500" ry="960" fill="none" stroke="#bfefff" stroke-width="2" opacity=".6"/>
  </g>
  ${ASTRONAUT}
</g>
<g fill="none" stroke="#1e262e" stroke-width="22" stroke-linejoin="round">${paths}</g>
<g fill="none" stroke="#3a4550" stroke-width="2">${paths}</g>
<path d="M0 0 H1600 V40 Q800 20 0 40 Z" fill="#11161b"/>
<rect y="600" width="1600" height="400" fill="#0b0f13"/>
</svg>
${wideConsole(t, f, log)}
${compactConsole(t, f, log)}
</g>
</svg>`

const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: 'flight-deck', glass: { blur: 10, tint: '#0c1014', opacity: 0.62 } },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))

    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }

    // First reading, so the screens aren't blank before the first turn ends.
    const u = await $.session.usage()
    const now = await $.clock.now()
    await update($, telemetry, () => toTelemetry(u, u.startedAt, now))
    const model = await $.session.model()
    await update($, flight, prev => ({ ...prev, model }))
    const turns = await $.session.turns()
    await update($, missionLog, prev => ({ ...prev, turns }))

    const set = await $.theme.set(LOOK)

    if (!set.isDrawn) {
      $.ui.status(set.reason)
    }

    return next(e)
  })

  // Pushed by the engine after each turn and when a rate-limit window moves.
  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, telemetry, prev => toTelemetry(e, prev.startedAt, now))
    const turns = await $.session.turns()
    const calls = pendingCalls
    pendingCalls = 0
    await update($, missionLog, prev => ({ turns, toolCalls: prev.toolCalls + calls }))
    return next(e)
  })

  // Count every tool call (subagents' included); committed at the next measure.
  on('tool.call', async ($, e, next) => {
    pendingCalls += 1
    return next(e)
  })

  // Each main-loop request names the model and effort it actually goes out with.
  // Each main-loop request names the model and effort it goes out with; the
  // cockpit only reads them, it never changes them.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const effort = e.effort ?? null
      const prev = await read($, flight)
      if (prev.model !== e.model || prev.effort !== effort) {
        await update($, flight, () => ({ model: e.model, effort }))
      }
    }
    return yield* next(e)
  })

  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)
    const t = await read($, telemetry)
    const f = await read($, flight)
    const log = await read($, missionLog)

    return (
      <Svg
        source={scene(t, f, log, e.surface === 'desktop' ? SIDEBAR_PX : 0)}
        alt={`A space shuttle flight deck at orbital night, a space-suited mascot drifting past now and then; its screens show ${modelName(f.model)}, effort, context, cost, turns and the weekly limit`}
        isInteractive
      />
    )
  })
}
