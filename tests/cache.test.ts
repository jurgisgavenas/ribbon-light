import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2098-12-31T22:00:00Z')
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 18, resetsAt: '2099-01-01T01:29:00Z' },
  { kind: 'seven_day', percentUsed: 1 },
]
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const
const WARM_IDLE = 18 * 60 // 18 minutes: warm, cold in 42m
const COLD_IDLE = (3 * 24 + 9) * 3600 // 3d 9h: cold

test('a warm cache shows Robo, the WARM chip and the minutes left, folded', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon-light', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  // Drawings keep no key in the kit, so they are found by what they say.
  // The usage bars are drawings too (alt '<n>% left'); these assertions are about the cache.
  const alts = (await band.findAll({ type: 'Svg' })).map(s => s.props.alt).filter(a => !String(a).endsWith('% left'))
  expect(alts).toEqual(['Robo, bobbing', 'WARM'])
  // The WARM pill carries the keep-warm switch as an invisible Button laid over it.
  expect(await band.find({ key: 'keep-warm' })).toBeDefined()
  expect(await band.find({ text: ' 42m' })).toBeDefined()
  expect(await band.find({ key: 'card' })).toBeUndefined()
  expect((await band.find({ key: 'cache-fold' }))?.props.label).toBe('Show')

  await band.press({ key: 'cache-fold' })
  expect(await band.find({ key: 'card' })).toBeDefined()
  expect((await band.find({ key: 'cache-fold' }))?.props.label).toBe('Hide')
  await band.unmount()
})

test('a cold cache stays folded until Show, which opens the card with the re-cache price', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon-light', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ key: 'card' })).toBeUndefined()
  await band.press({ key: 'cache-fold' })
  const card = await band.find({ key: 'card' })
  expect(card).toBeDefined()
  expect(JSON.stringify(card)).toContain('Cache cold. Idle 3d 9h. Next message re-caches 770k tokens.')
  // The page's width: 80 columns is a 1020 px band.
  expect(JSON.stringify(card)).toContain('width=\\"1020\\"')

  await band.press({ key: 'cache-fold' })
  expect(await band.find({ key: 'card' })).toBeUndefined()
  expect(await band.find({ text: ' 3d 9h' })).toBeDefined()
  // Opus 5.5: 770k tokens at the 1-hour write price, 2 x $4 per million.
  expect(await band.find({ text: '$6.16' })).toBeDefined()
  await band.unmount()
})

test('squeezed, the desktop band stays one row (no Robo, no cost); the card still fits the band', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const half = await $.ui.mount({ plugin: 'ribbon-light', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 53 } })
  expect(await half.find({ key: 'block' })).toBeUndefined()
  expect(await half.find({ key: 'row' })).toBeDefined()
  expect(await half.find({ text: ' 42m' })).toBeDefined()
  expect((await half.findAll({ type: 'Svg' })).map(s => s.props.alt)).not.toContain('Robo, bobbing')
  await half.unmount()

  const narrow = await $.ui.mount({ plugin: 'ribbon-light', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 33 } })
  expect(await narrow.find({ key: 'cache' })).toBeUndefined()
  await narrow.press({ key: 'cache-fold' })
  // Narrow's card is the compact one: 38 columns is a 456 px band.
  expect(JSON.stringify(await narrow.find({ key: 'card' }))).toContain('width=\\"456\\"')
  await narrow.unmount()
})

test('the terminal draws the cache as text, with no drawings and no fold button', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon-light', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: 'COLD' })).toBeDefined()
  expect(await band.find({ text: '$6.16' })).toBeDefined()
  expect(await band.findAll({ type: 'Svg' })).toEqual([])
  expect(await band.find({ key: 'cache-fold' })).toBeUndefined()
  expect(await band.find({ key: 'card' })).toBeUndefined()
  await band.unmount()
})

test('a cleared session drops the cache until the next reply', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })
  await $.classic.SessionStart({ source: 'clear' })

  const band = await $.ui.mount({ plugin: 'ribbon-light', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const cacheSvgs = (await band.findAll({ type: 'Svg' })).filter(s => !String(s.props.alt).endsWith('% left'))
  expect(cacheSvgs).toEqual([])
  expect(await band.find({ text: ' 99%' })).toBeDefined()
  await band.unmount()
})
