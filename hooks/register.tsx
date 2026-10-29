import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheFacts, Fold, KeepWarm, Window } from '../types'
import {
  EMPTY, HUE, INK, ROBO_SIZE, TTL_MIN, TTL_MS, WORD,
  bandPx, cardSvg, chipSvg, costOf, familyOf, fmtIdle, kindOf, mineModel, roboSvg, usd,
} from './cache-art'
import type { CacheView } from './cache-art'

// A band above the prompt in a warm dark look: card surface, cream text,
// dot-matrix bars. Shows how much of each usage window is LEFT, 7-day first, then
// 5-hour; each bar is green, amber under 30% left, red under 15%, which adds a bold LOW.
//
// After the first reply it also shows the prompt cache: WARM (red, Robo bobbing)
// for an hour after the last request, then COLD (blue, Robo frozen) with what the
// next message costs to re-cache. Hide / Show folds the card; warm starts folded,
// cold starts open, and a choice holds until the cache flips. Zero token cost:
// it reads the engine's own figures and draws.

const CELLS = 10
const LOW_AT = 15
const TIGHT_CELLS = 6
/** How often the band redraws, so the countdown and the warm-to-cold flip stay current. */
const TICK_MS = 30_000

const windows = atom({ plugin: 'ribbon-light', key: 'windows' } as const, [] as Window[])
const cache = atom({ plugin: 'ribbon-light', key: 'cache' } as const, null as CacheFacts | null)
const fold = atom({ plugin: 'ribbon-light', key: 'fold' } as const, null as Fold | null)
const keep = atom({ plugin: 'ribbon-light', key: 'keep' } as const, null as KeepWarm | null)

// Keep warm: while on, re-read the cached conversation shortly before the hour runs out, so a
// session stays warm overnight. The ping is a $.model.fork, which adds nothing to the transcript.
const PING_AT_MS = TTL_MS - 8 * 60 * 1000
const KEEP_MAX_MS = 12 * 60 * 60 * 1000
const KEEP_CHECK_MS = 60_000
/** Shown beside WARM while keep-warm is off; 🔥 replaces it while on. */
const OFF_EMOJI = '🪵'
// One ping at a time: the minute timer can tick again while a ping is still answering.
let isPinging = false
// After a failed ping, wait before the next try instead of retrying every minute.
const RETRY_MS = 5 * 60 * 1000
let failedAt = 0

const NAMES: Record<string, string> = { seven_day: '7D', five_hour: '5H', spend_limit: 'SPEND' }
const ORDER: Record<string, number> = { seven_day: 0, five_hour: 1 }
const AMBER_AT = 30
/** Colour by how much is left, not by which window: the 7D / 5H labels tell them apart. */
const colorOf = (left: number): string => (left < LOW_AT ? '#d93c3b' : left < AMBER_AT ? '#c27c0e' : '#4f8a1c')

const clean = (list: readonly Window[]): Window[] =>
  list
    .map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }))
    .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))

const BAR_W = 44
const BAR_H = 6
const barSvg = (left: number, col: string): string => {
  const w = Math.round((Math.max(0, Math.min(100, left)) / 100) * BAR_W)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_W}" height="${BAR_H}" viewBox="0 0 ${BAR_W} ${BAR_H}">` +
    `<rect width="${BAR_W}" height="${BAR_H}" rx="3" fill="${EMPTY}"/>` +
    (w > 0 ? `<rect width="${w}" height="${BAR_H}" rx="3" fill="${col}"/>` : '') +
    '</svg>'
  )
}

const dots = (left: number, cells: number): { on: string; off: string } => {
  const n = Math.max(0, Math.min(cells, Math.round((left / 100) * cells)))
  return { on: '●'.repeat(n), off: '·'.repeat(cells - n) }
}

const fmtReset = (iso: string | undefined, now: number): string => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (Number.isNaN(ms)) return ''
  if (ms <= 0) return 'resetting'
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** What the cache drawings read, or null until a request and its context size are known. */
export const viewOf = (c: CacheFacts | null, now: number): CacheView | null => {
  if (!c || c.lastAt <= 0 || c.tokens <= 0) return null
  const idleMs = Math.max(0, now - c.lastAt)
  return {
    mode: idleMs >= TTL_MS ? 'cold' : 'warm',
    idle: fmtIdle(idleMs),
    idleMin: Math.floor(idleMs / 60000),
    tokens: c.tokens,
    window: c.window,
    mine: familyOf(c.model),
  }
}

// pull and measure are inlined into their hooks: the validator refuses $ handed to
// update() from a helper function.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const u = await $.session.usage()
    await update($, windows, () => clean(u.rateLimits))
    $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
    $.clock.every(KEEP_CHECK_MS, () => {
      void (async () => {
        const k = await read($, keep)
        if (!k?.on) return
        const now = await $.clock.now()
        if (now - k.since > KEEP_MAX_MS) {
          await update($, keep, () => ({ on: false, since: 0 }))
          $.ui.toast('Keep warm switched off after 12 h')
          return
        }
        const c = await read($, cache)
        if (isPinging || now - failedAt < RETRY_MS || !c || c.lastAt <= 0 || now - c.lastAt < PING_AT_MS) return
        isPinging = true
        try {
          const r = await $.model.fork({ prompt: 'Keep-alive ping to hold the prompt cache. Reply with just: ok' })
          if (!r.isAnswered) {
            failedAt = now
            $.ui.toast(`Keep warm ping failed (${r.reason}); retrying in 5 min`)
            return
          }
          await update($, cache, prev => (prev ? { ...prev, lastAt: now } : prev))
        } catch (err) {
          failedAt = now
          $.ui.toast(`Keep warm ping failed (${String(err)}); retrying in 5 min`)
        } finally {
          isPinging = false
        }
      })()
    })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, windows, () => clean(e.rateLimits))
    }
    if (e.changed.includes('context') && e.context.tokens && e.context.tokens > 0) {
      const tokens = e.context.tokens
      await update($, cache, c => (c ? { ...c, tokens, window: e.context.window || c.window } : c))
    }
    return next(e)
  })

  // A resumed or forked session knows how long it was away and how big it is.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.source === 'clear' || e.source === 'compact') {
      await update($, cache, () => null)
      await update($, fold, () => null)
    } else if ((e.source === 'resume' || e.source === 'fork') && typeof e.seconds_since_last_response === 'number') {
      const now = await $.clock.now()
      const lastAt = now - e.seconds_since_last_response * 1000
      const window = (await $.session.usage()).context.window
      const model = typeof e.model === 'string' ? e.model : await $.session.model()
      const tokens = typeof e.context_tokens === 'number' ? e.context_tokens : 0
      await update($, cache, () => ({ lastAt, tokens, window, model }))
    }
    return r
  }).catch(($, e, next) => next(e)) // a band that fails to seed never holds up the session

  // Each main-thread request reads or writes the cache, so its start resets the hour.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const now = await $.clock.now()
      await update($, cache, c => ({ lastAt: now, tokens: c?.tokens ?? 0, window: c?.window ?? 0, model: c?.model ?? null }))
    }
    yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    const now = await $.clock.now()
    const c = await read($, cache)
    // turn.step stamps the exact request time; when no step of this turn did, the turn's end is the floor.
    const lastAt = !c || now - c.lastAt > e.durationMs ? now : c.lastAt
    // Fresh context figures from the engine onto the cache facts, when it has them.
    const u = await $.session.usage()
    const m = e.usage?.model ?? (await $.session.model())
    await update($, cache, prev => ({
      lastAt,
      tokens: u.context.tokens && u.context.tokens > 0 ? u.context.tokens : (prev?.tokens ?? 0),
      window: u.context.window || prev?.window || 0,
      model: m || prev?.model || null,
    }))
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // Svg draws on desktop, mobile and VS Code; the terminal gets the text form.
    // Ask the surface, not the table: the terminal's table still lists Svg.
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null
    const list = await read($, windows)
    const now = await $.clock.now()
    const view = viewOf(await read($, cache), now)

    if (list.length === 0 && !view) {
      return (
        <Box paddingX={1}>
          <Text color="inactive">USAGE · waiting for the first reply</Text>
        </Box>
      )
    }

    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 100
    // Where the surface draws, the band is always ONE row: detail is dropped as it narrows, never
    // wrapped. 0 = everything, 1 = no 'left' words and short resets, 2 = no resets and no Robo.
    const kind = Svg ? 'wide' : kindOf(columns)
    const level = !Svg ? 0 : columns >= 100 ? 0 : columns >= 80 ? 1 : 2
    const isWide = kind === 'wide'
    const cells = kind === 'tight' ? TIGHT_CELLS : CELLS

    const parts = (w: Window) => {
      const left = Math.max(0, Math.round((100 - w.percentUsed) * 10) / 10)
      return {
        left,
        col: colorOf(left),
        name: NAMES[w.kind] ?? w.kind.toUpperCase(),
        d: dots(left, cells),
        reset: fmtReset(w.resetsAt, now),
      }
    }

    // Wide: every window on one row. Narrow: each window is a block of three
    // lines (name and dots, percent left, reset time) so nothing wraps or clips.
    // A slim drawn bar where the surface draws Svg, so both windows and the cache fit one row.
    const wide = (w: Window, i: number) => {
      const p = parts(w)
      return (
        <Box key={`w-${i}`} flexDirection="row" flexShrink={0} marginRight={level === 2 ? 2 : 3} alignItems="center">
          <Text color="inactive" bold>{p.name} </Text>
          {Svg ? (
            <Svg source={barSvg(p.left, p.col)} alt={`${p.left}% left`} width={BAR_W} height={BAR_H} />
          ) : (
            [<Text key="on" color={p.col}>{p.d.on}</Text>, <Text key="off" color="subtle">{p.d.off}</Text>]
          )}
          <Text color={p.col} bold> {p.left}%{level === 0 ? ' left' : ''}</Text>
          {p.left < LOW_AT ? <Text color="text" bold> LOW</Text> : null}
          {p.reset && level < 2 ? <Text color="inactive"> · {level === 0 ? p.reset : p.reset.split(' ')[0]}</Text> : null}
        </Box>
      )
    }

    const stacked = (w: Window, i: number) => {
      const p = parts(w)
      return (
        <Box key={`w-${i}`} flexDirection="column" flexShrink={0} marginRight={3}>
          <Box flexDirection="row">
            <Text color="inactive" bold>{p.name} </Text>
            <Text color={p.col}>{p.d.on}</Text>
            <Text color="subtle">{p.d.off}</Text>
          </Box>
          <Box flexDirection="row">
            <Text color={p.col} bold>{p.left}% left</Text>
            {p.left < LOW_AT ? <Text color="text" bold> LOW</Text> : null}
          </Box>
          {p.reset ? <Text color="inactive">resets {p.reset}</Text> : null}
        </Box>
      )
    }

    const label = (
      <Box key="label" flexShrink={0} marginRight={isWide ? 2 : 3}>
        <Text color="text" bold>USAGE</Text>
      </Box>
    )
    const usage = list.length > 0
      ? list.map(isWide ? wide : stacked)
      : [<Box key="wait" flexShrink={0} marginRight={3}><Text color="inactive">waiting for the first reply</Text></Box>]

    // Before the first reply there is no cache to show: today's band, as it was.
    if (!view) {
      return (
        <Box flexDirection="row" paddingX={1}>
          {label}
          {usage}
        </Box>
      )
    }

    const mode = view.mode
    const cold = mode === 'cold'
    const hue = HUE[mode]
    const mine = mineModel(view)
    const stored = await read($, fold)
    // Folding needs the card, and the card is a drawing: the terminal stays folded.
    // It opens only on Show (cold no longer opens it by itself), so the band never grows unasked.
    const open = Svg !== null && stored !== null && stored.mode === mode && stored.open
    const toggle = () => update($, fold, f => ({ mode, open: !(f && f.mode === mode && f.open) }))

    // The WARM / COLD tag is itself the keep-warm switch: a press turns it on or off, and a 🔥 after
    // the tag shows it is on. A Button takes only text, so the tag is coloured text, not a drawing.
    // No `label`: the desktop draws a Button's label instead of its children.
    const kept = await read($, keep)
    const isKept = kept?.on === true
    // The WARM / COLD pill is the original drawing; a Button can't hold a drawing, so an invisible
    // Button is laid over the pill as its click area. A press turns keep-warm on or off; a 🔥 after
    // the pill shows it is on. The terminal has no drawings: there the Button is the text tag.
    const pressKeep = async () => {
      const now = await $.clock.now()
      await update($, keep, k => (k?.on ? { on: false, since: 0 } : { on: true, since: now }))
    }
    const art = chipSvg(mode)
    const chip = Svg ? (
      <Box key="chip" position="relative" flexShrink={0}>
        <Svg source={art.source} alt={WORD[mode]} width={art.w} height={art.h} />
        <Box position="absolute" top={0} left={0}>
          <Button key="keep-warm" plain onPress={pressKeep}>{'\u00a0'.repeat(Math.ceil(art.w / 4.5))}</Button>
        </Box>
      </Box>
    ) : (
      <Button key="keep-warm" plain onPress={pressKeep}>
        <Text backgroundColor={hue} color={INK} bold>{` ${WORD[mode]} `}</Text>
      </Button>
    )
    // The emoji beside the pill is a second click target: 🔥 while keeping warm, OFF_EMOJI while not.
    const fire = (
      <Button key="keep-emoji" plain onPress={pressKeep}>
        <Text>{isKept ? ' 🔥' : ` ${OFF_EMOJI}`}</Text>
      </Button>
    )
    const badge = Svg
      ? [
          level === 2 ? null : <Svg key="robo" source={roboSvg(mode)} alt={cold ? 'Robo, frozen' : 'Robo, bobbing'} width={ROBO_SIZE} height={ROBO_SIZE} isInteractive />,
          <Text key="gap"> </Text>,
          chip,
          fire,
        ]
      : [chip, fire]

    const summary = cold
      ? [
          <Text key="idle" color={hue} bold>{` ${view.idle}`}</Text>,
          mine && level < 2 ? <Text key="dot" color="inactive"> · </Text> : null,
          mine && level < 2 ? <Text key="cost" color="text" bold>{usd(costOf(mine, mode, view.tokens))}</Text> : null,
        ]
      : [<Text key="left" color={hue} bold>{` ${Math.max(0, TTL_MIN - view.idleMin)}m${level === 0 ? ' left' : ''}`}</Text>]

    const button = Svg ? (
      <Box key="fold" flexShrink={0} alignItems="flex-start">
        <Button key="cache-fold" plain label={open ? 'Hide' : 'Show'} onPress={toggle} />
      </Box>
    ) : null
    const grow = <Box key="grow" flexGrow={1} />

    let rows
    if (kind === 'wide') {
      rows = (
        <Box key="row" flexDirection="row" flexWrap="nowrap" paddingX={1} alignItems="center">
          {Svg ? null : label}
          {usage}
          {open ? null : (
            <Box key="inline" flexDirection="row" flexShrink={0} marginRight={2} alignItems="center">
              {badge}
              {summary}
            </Box>
          )}
          {grow}
          {button}
        </Box>
      )
    } else if (kind === 'stacked') {
      // The cache becomes a third stacked block, the same shape as 7D and 5H.
      rows = (
        <Box key="row" flexDirection="row" paddingX={1}>
          {label}
          {usage}
          {open ? null : (
            <Box key="block" flexDirection="column" flexShrink={0} marginRight={2}>
              <Box flexDirection="row" alignItems="center">{badge}</Box>
              <Text color={hue} bold>{cold ? `${view.idle} idle` : `${Math.max(0, TTL_MIN - view.idleMin)}m left`}</Text>
              {mine ? (
                <Box flexDirection="row">
                  <Text color="text" bold>{usd(costOf(mine, mode, view.tokens))}</Text>
                  <Text color="inactive"> next</Text>
                </Box>
              ) : null}
            </Box>
          )}
          {grow}
          {button}
        </Box>
      )
    } else {
      // Narrow: the cache gets its own row under the usage blocks.
      rows = [
        <Box key="row" flexDirection="row" paddingX={1}>
          {label}
          {usage}
        </Box>,
        <Box key="cache" flexDirection="row" paddingX={1} alignItems="center">
          {badge}
          {summary}
          {grow}
          {button}
        </Box>,
      ]
    }

    let card = null
    if (open && Svg) {
      const c = cardSvg(view, kindOf(columns), bandPx(columns))
      card = (
        <Box key="card" flexDirection="row">
          <Svg source={c.source} alt={c.alt} width={c.w} height={c.h} isInteractive={kind !== 'tight'} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {rows}
        {card}
      </Box>
    )
  })
}
