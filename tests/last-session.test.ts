import { expect, mock, test } from 'claude-code/testing'

import { draw } from './render'

const TOML = 'workspace = "w"\nproject = "p"\n'
const PANE = {
  plugin: 'memory-lens',
  component: 'Pane',
  requestId: 'memory-lens',
  surface: 'terminal',
  props: { title: 'memory-lens', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const write = { tool: 'mcp__ai-memory__memory_write_page', path: 'notes/a.md' }
const ending = { reason: 'other', sessionId: 's', resume: { id: 's' } } as any
const start = { cwd: '/r', surface: 'terminal', isInteractive: true } as const

async function setup($: any, on: any, writeFails = false, answer?: (e: any) => object) {
  const seen: string[] = []
  mock.store(on)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => (seen.push('open'), { value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('fs.read', (_: any, e: any) => {
    if (e.path === '/r/.ai-memory.toml') return { value: TOML }
    throw new Error('ENOENT')
  })
  on('mcp.call', () => ({ value: { isError: false, content: [{ type: 'text', text: '{"hits":[]}' }] } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 's' }))
  on('tool.call', (_: any, e: any) => answer?.(e) ?? (writeFails ? { result: {}, text: '{}', isError: true } : { result: {}, text: '{}' }))
  await $.session.start(start)
  return seen
}

async function leftOff($: any) {
  const ui = await $.ui.mount(PANE)
  const line = draw(await ui.drawn(), PANE.props.bodyColumns).find(l => l.startsWith(' Last session'))
  await ui.unmount()
  return line?.trim()
}

test('a session that saved a page leaves a last-session line the next session shows once', async ($, on) => {
  const seen = await setup($, on)
  await $.tool.call(write)
  await $.session.end(ending)
  seen.length = 0
  await $.session.start(start)
  expect(await leftOff($)).toBe('Last session: saved 1 page')
  expect(seen).toContain('open')
  await $.session.end(ending)
  await $.session.start(start)
  expect(await leftOff($)).toBeUndefined()
})

test('a session that saved nothing stores nothing', async ($, on) => {
  const seen = await setup($, on, true)
  await $.tool.call(write)
  await $.session.end(ending)
  seen.length = 0
  await $.session.start(start)
  expect(await leftOff($)).toBeUndefined()
  expect(seen).not.toContain('open')
})

test('a denied handoff begin and a handoff accept store nothing', async ($, on) => {
  const seen = await setup($, on, false, e => (e.tool.endsWith('handoff_begin') ? { deny: 'no' } : { result: {}, text: '{}' }))
  await $.tool.call({ tool: 'mcp__ai-memory__memory_handoff_begin' })
  await $.tool.call({ tool: 'mcp__ai-memory__memory_handoff_accept' })
  await $.session.end(ending)
  seen.length = 0
  await $.session.start(start)
  expect(await leftOff($)).toBeUndefined()
  expect(seen).not.toContain('open')
})

test('a handoff begin is counted in the last-session line', async ($, on) => {
  await setup($, on)
  await $.tool.call({ tool: 'mcp__ai-memory__memory_handoff_begin' })
  await $.session.end(ending)
  await $.session.start(start)
  expect(await leftOff($)).toBe('Last session: saved 0 pages, 1 handoff')
})

test('a session whose only memory write is a delete stores no last-session line', async ($, on) => {
  const seen = await setup($, on)
  await $.tool.call({ tool: 'mcp__ai-memory__memory_delete_page', path: 'notes/a.md' })
  await $.session.end(ending)
  seen.length = 0
  await $.session.start(start)
  expect(await leftOff($)).toBeUndefined()
  expect(seen).not.toContain('open')
})
