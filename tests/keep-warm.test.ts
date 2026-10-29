import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2098-12-31T22:00:00Z')
const WINDOWS = [{ kind: 'five_hour', percentUsed: 18, resetsAt: '2099-01-01T01:29:00Z' }]
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const
const MIN = 60 * 1000

const setup = async ($: any, on: any) => {
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  const forks: string[] = []
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  on('model.fork', (_$: any, e: any) => {
    forks.push(`${(clock.now() - NOW) / 60000}m`)
    return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 770000, cache_creation_input_tokens: 0 } } }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  // Last request 10 minutes ago: warm, 50m left.
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 10 * 60, context_tokens: 770000, model: 'claude-opus-5-5' })
  return { clock, forks }
}

test('keep warm is off by default and never pings', async ($, on) => {
  const { clock, forks } = await setup($, on)
  const band = await $.ui.mount({ plugin: 'ribbon-light', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: ' 🔥' })).toBeUndefined()
  await clock.advance(70 * MIN)
  expect(forks.length).toBe(0)
  await band.unmount()
})

test('switched on, it pings once shortly before the hour runs out, then waits another hour', async ($, on) => {
  const { clock, forks } = await setup($, on)
  const band = await $.ui.mount({ plugin: 'ribbon-light', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: ' 🔥' })).toBeUndefined()
  await band.press({ key: 'keep-warm' })
  expect(await band.find({ text: ' 🔥' })).toBeDefined()

  await clock.advance(40 * MIN) // idle 50m: not yet
  expect(forks.length).toBe(0)
  await clock.advance(3 * MIN) // idle 53m: past the 52m ping point
  expect(forks).toEqual(['42m'])
  expect(await band.find({ text: ' 59m left' })).toBeDefined()
  await clock.advance(30 * MIN) // 30m after the ping: still warm, no second ping
  expect(forks).toEqual(['42m'])
  await clock.advance(23 * MIN) // 53m after the ping: pings again
  expect(forks).toEqual(['42m', '94m'])
  expect(await band.find({ text: 'COLD' })).toBeUndefined()
  await band.unmount()
})

test('switching it off stops the pings', async ($, on) => {
  const { clock, forks } = await setup($, on)
  const band = await $.ui.mount({ plugin: 'ribbon-light', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await band.press({ key: 'keep-warm' })
  await band.press({ key: 'keep-warm' })
  expect(await band.find({ text: ' 🔥' })).toBeUndefined()
  await clock.advance(70 * MIN)
  expect(forks.length).toBe(0)
  await band.unmount()
})

test('a failed ping is reported and retried after 5 minutes, not every minute', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  const forks: number[] = []
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  on('model.fork', () => {
    forks.push((clock.now() - NOW) / MIN)
    return { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded_error', usage: { input_tokens: 0, output_tokens: 0 } } }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 10 * 60, context_tokens: 770000, model: 'claude-opus-5-5' })
  const band = await $.ui.mount({ plugin: 'ribbon-light', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await band.press({ key: 'keep-warm' })
  await clock.advance(50 * MIN)
  expect(forks).toEqual([42, 47])
  await band.unmount()
})

test('the emoji beside WARM shows the log when off and also toggles keep warm', async ($, on) => {
  const { forks } = await setup($, on)
  const band = await $.ui.mount({ plugin: 'ribbon-light', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: ' 🪵' })).toBeDefined()
  await band.press({ key: 'keep-emoji' })
  expect(await band.find({ text: ' 🔥' })).toBeDefined()
  expect(await band.find({ text: ' 🪵' })).toBeUndefined()
  await band.press({ key: 'keep-emoji' })
  expect(await band.find({ text: ' 🪵' })).toBeDefined()
  expect(forks.length).toBe(0)
  await band.unmount()
})
