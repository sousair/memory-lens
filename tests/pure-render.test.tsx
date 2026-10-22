import { expect, test } from 'claude-code/testing'

import { draw } from './render'

const TOML = 'workspace = "w"\nproject = "p"\n'
const PANE = {
  plugin: 'memory-lens',
  component: 'Pane',
  requestId: 'memory-lens',
  surface: 'terminal',
  props: { title: 'memory-lens', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const
const RECENT = JSON.stringify({ hits: [{ id: '1', path: 'notes/next.md', title: 'Next thing', snippet: 's' }] })

async function setup($: any, on: any) {
  const calls = { mcp: 0, state: 0, store: 0, logs: [] as string[] }
  const store = new Map<string, unknown>()
  on('store.get', (_: any, e: any) => ({ value: store.get(e.key) }))
  on('store.delete', (_: any, e: any) => (store.delete(e.key), { value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', (_: any, e: any) => (calls.logs.push(e.text), { value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('fs.read', (_: any, e: any) => {
    if (e.path === '/r/.ai-memory.toml') return { value: TOML }
    throw new Error('ENOENT')
  })
  on('mcp.call', () => (calls.mcp++, { value: { isError: false, content: [{ type: 'text', text: RECENT }] } }))
  on('state.set', ($: any, e: any, next: any) => (calls.state++, next(e)))
  on('store.set', (_: any, e: any) => (calls.store++, store.set(e.key, e.value), { value: undefined }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('command.run', () => ({}))
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
  return calls
}

async function lines($: any) {
  const ui = await $.ui.mount(PANE)
  const drawn = draw(await ui.drawn(), PANE.props.bodyColumns)
  await ui.unmount()
  return drawn
}

test('drawing the pane makes no MCP call and writes no state or store', async ($, on) => {
  const calls = await setup($, on)
  await $.command.run({ command: 'memory-lens' } as any)
  const before = { ...calls, logs: calls.logs.length }
  const all = await lines($)
  expect(all).toContain(' Next thing')
  expect({ mcp: calls.mcp, state: calls.state, store: calls.store, logs: calls.logs.length }).toEqual(before)
})

test('opening the pane refreshes left off once, not once per draw', async ($, on) => {
  const calls = await setup($, on)
  const before = calls.mcp
  await $.command.run({ command: 'memory-lens' } as any)
  for (let i = 0; i < 3; i++) await lines($)
  expect(calls.mcp - before).toBe(1)
})

test('left off reads loading until its first refresh', async ($, on) => {
  on('ui.log', () => ({ value: undefined }))
  const all = await lines($)
  expect(all[all.indexOf('LEFT OFF') + 1]).toBe(' loading…')
})
