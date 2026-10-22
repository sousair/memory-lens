import { expect, mock, test } from 'claude-code/testing'

import { draw } from './render'

const TOML = 'workspace = "w"\nproject = "p"\n'
const PANE = {
  plugin: 'memory-lens',
  component: 'Pane',
  requestId: 'memory-lens',
  props: { title: 'memory-lens', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const write = { tool: 'mcp__ai-memory__memory_write_page', path: 'notes/a.md' }
const read = { tool: 'mcp__ai-memory__memory_read_page', path: 'notes/a.md' }
const page = JSON.stringify({ path: 'notes/a.md', title: 'Alpha plan', body: 'x' })
const hits = JSON.stringify({ hits: ['b', 'c', 'd'].map(id => ({ id, path: `notes/${id}.md`, title: `Page ${id}`, snippet: 's' })) })

async function setup($: any, on: any, opts: { recent?: () => any; viewport?: object | null; openFails?: boolean; closeFails?: boolean } = {}) {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  const seen: string[] = []
  const toasts: string[] = []
  on('ui.toast', (_: any, e: any) => (toasts.push(e.text), { value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  const registered: string[] = []
  on('command.register', (_: any, e: any) => (registered.push(e.name), { value: undefined }))
  on('session.attach', (_: any, e: any) => ({ surface: e.surface, clientId: e.clientId, viewport: e.viewport }))
  on('ui.open', (_: any, e: any) => (opts.openFails && (() => { throw new Error('open down') })(), seen.push(`open:${JSON.stringify(e)}`), { value: { isPlaced: true } }))
  on('ui.close', (_: any, e: any) => (opts.closeFails && (() => { throw new Error('close down') })(), seen.push('close'), { value: undefined }))
  on('fs.read', (_: any, e: any) => {
    if (e.path === '/r/.ai-memory.toml') return { value: TOML }
    throw new Error('ENOENT')
  })
  on('mcp.call', () => opts.recent?.() ?? { value: { isError: false, content: [{ type: 'text', text: JSON.stringify({ hits: [{ id: '1', path: 'notes/last.md', title: 'Last thing', snippet: 's' }] }) }] } })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('command.run', () => ({}))
  on('tool.call', (_: any, e: any) => ({ result: {}, text: e.tool.endsWith('memory_query') ? hits : e.path === 'notes/a.md' && e.tool.endsWith('read_page') ? page : '{}' }))
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
  if (opts.viewport !== null) await $.session.attach({ surface: 'desktop', clientId: 'd:1', viewport: opts.viewport ?? { columns: 200, rows: 40, isFullscreen: true } } as any)
  return { clock, seen, toasts, registered }
}

const opens = (seen: string[]) => seen.filter(s => s.startsWith('open:'))

test('in auto a memory write opens the pane and it closes after the idle delay', async ($, on) => {
  const { clock, seen } = await setup($, on)
  await $.tool.call(write)
  expect(opens(seen).length).toBe(1)
  expect(opens(seen)[0]).toBe('open:{"id":"memory-lens","title":"memory-lens"}')
  await clock.advance(24_000)
  expect(seen).not.toContain('close')
  await clock.advance(2_000)
  expect(seen).toContain('close')
})

test('a second write pushes the idle close out', async ($, on) => {
  const { clock, seen } = await setup($, on)
  await $.tool.call(write)
  await clock.advance(20_000)
  await $.tool.call(write)
  await clock.advance(10_000)
  expect(seen).not.toContain('close')
  await clock.advance(16_000)
  expect(seen).toContain('close')
})

for (const mode of ['on', 'off', 'auto'] as const) {
  test(`in ${mode} /memory-lens toggles the pane${mode === 'off' ? ' and a write does not open it' : ''}`, { options: { mode } }, async ($, on) => {
    const { seen } = await setup($, on)
    const before = opens(seen).length
    if (mode === 'off') {
      await $.tool.call(write)
      expect(opens(seen).length).toBe(before)
    }
    await $.command.run({ command: 'memory-lens' } as any)
    if (mode === 'on') {
      expect(before).toBe(1)
      expect(seen).toContain('close')
    } else {
      expect(opens(seen).length).toBe(before + 1)
    }
  })
}

test('/memory-lens pins an auto-opened pane, a second one closes it', async ($, on) => {
  const { clock, seen } = await setup($, on)
  await $.tool.call(write)
  expect((await $.command.run({ command: 'mem' } as any)).text).toBe('memory-lens pane pinned open.')
  await clock.advance(60_000)
  expect(seen).not.toContain('close')
  expect((await $.command.run({ command: 'mem' } as any)).text).toBe('memory-lens pane closed.')
  expect(seen).toContain('close')
})

test('a pane opened by /memory-lens never auto-closes', async ($, on) => {
  const { clock, seen } = await setup($, on)
  await $.command.run({ command: 'memory-lens' } as any)
  await $.tool.call(write)
  await clock.advance(60_000)
  expect(opens(seen).length).toBe(1)
  expect(seen).not.toContain('close')
})

test('/memory-lens closes a pinned pane, and reopening it by hand never auto-closes', async ($, on) => {
  const { clock, seen } = await setup($, on)
  await $.tool.call(write)
  await $.command.run({ command: 'memory-lens' } as any)
  await $.command.run({ command: 'memory-lens' } as any)
  expect(seen).toContain('close')
  seen.length = 0
  await $.command.run({ command: 'memory-lens' } as any)
  await clock.advance(60_000)
  expect(opens(seen).length).toBe(1)
  expect(seen).not.toContain('close')
})

const SURFACES = ['terminal', 'desktop'] as const

const present = ($: any, presentation?: object) => $.command.run({ command: 'memory-lens', presentation } as any)

for (const [label, viewport] of [['narrow', { columns: 100, isFullscreen: true }], ['main screen', { columns: 200, isFullscreen: false }]] as const) {
  test(`auto does not open the pane on a ${label} viewport`, async ($, on) => {
    const { seen, toasts } = await setup($, on, { viewport })
    seen.length = 0
    await $.tool.call(write)
    await $.tool.call(read)
    expect(opens(seen).length).toBe(0)
    expect(toasts).toEqual(['🧠 Alpha plan'])
  })
}

test('auto opens the pane when the viewport is unknown', async ($, on) => {
  const { seen } = await setup($, on, { viewport: null })
  await $.tool.call(write)
  expect(opens(seen).length).toBe(1)
})

test('a main-screen presentation from /memory-lens stops auto opening', async ($, on) => {
  const { seen } = await setup($, on, { viewport: null })
  await present($, { columns: 200, isFullscreen: false })
  await present($)
  seen.length = 0
  await $.tool.call(write)
  expect(opens(seen).length).toBe(0)
})

test('a failing ui.open is logged and answered as text, never thrown', async ($, on) => {
  await setup($, on, { openFails: true })
  expect((await present($)).text).toBe('memory-lens pane unavailable.')
})

test('a failing ui.close in the idle timer is swallowed', async ($, on) => {
  const { clock, seen } = await setup($, on, { closeFails: true })
  await $.tool.call(write)
  await clock.advance(26_000)
  expect(opens(seen).length).toBe(1)
})

async function lines($: any, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await $.ui.mount({ ...PANE, surface })
  const drawn = draw(await ui.drawn(), PANE.props.bodyColumns)
  await ui.unmount()
  return drawn
}

test('the pane shows the three sections and lists a read with its readable name', async ($, on) => {
  await setup($, on)
  await $.tool.call(read)
  await $.tool.call(write)
  for (const surface of SURFACES) {
    const all = await lines($, surface)
    for (const title of ['AT START', 'THIS SESSION', 'LEFT OFF']) expect(all.some(l => l.startsWith(title))).toBe(true)
    expect(all.find(l => l.startsWith('THIS SESSION'))).toMatch(/ 1 read · 1 saved$/)
    expect(all.some(l => /^ \d\d:\d\d read +Alpha plan$/.test(l))).toBe(true)
    expect(all).toContain(' not available')
    expect(all).toContain(' Last thing')
  }
})

test('the count counts each page row once and skips the unlisted kinds', async ($, on) => {
  await setup($, on)
  await $.tool.call({ tool: 'mcp__ai-memory__memory_query', query: 'q' })
  await $.tool.call({ tool: 'mcp__ai-memory__memory_status' })
  await $.tool.call(write)
  const all = await lines($)
  expect(all.find(l => l.startsWith('THIS SESSION'))).toMatch(/ 1 query · 3 reads · 1 saved$/)
  for (const id of ['b', 'c', 'd']) expect(all).toContain(`                 Page ${id}`)
  expect(all.some(l => l.includes('status'))).toBe(false)
})

test('with ai-memory unreachable the pane says unavailable and nothing throws', async ($, on) => {
  await setup($, on, { recent: () => { throw new Error('down') } })
  for (const surface of SURFACES) expect(await lines($, surface)).toContain(' unavailable')
})

test('an errored memory_recent also reads unavailable', async ($, on) => {
  await setup($, on, { recent: () => ({ value: { isError: true, content: [] } }) })
  expect(await lines($)).toContain(' unavailable')
})

test('a delete row reads removed, not saved', async ($, on) => {
  await setup($, on)
  await $.tool.call({ tool: 'mcp__ai-memory__memory_delete_page', path: 'notes/a.md' })
  const all = await lines($)
  expect(all.some(l => /^ \d\d:\d\d removed A$/.test(l))).toBe(true)
  expect(all.find(l => l.startsWith('THIS SESSION'))).toMatch(/SESSION +1 removed$/)
})

test('/mem toggles the pane like /memory-lens and both commands are registered', { options: { mode: 'off' } }, async ($, on) => {
  const { seen, registered } = await setup($, on)
  expect(registered).toEqual(['memory-lens', 'mem'])
  await $.command.run({ command: 'mem' } as any)
  expect(opens(seen).length).toBe(1)
  await $.command.run({ command: 'mem' } as any)
  expect(seen).toContain('close')
  await $.command.run({ command: 'memory-lens' } as any)
  expect(opens(seen).length).toBe(2)
})
