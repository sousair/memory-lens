import { expect, mock, test } from 'claude-code/testing'

const LONG = 'A page title long enough to run past a forty column pane uncut'
const RECENT = JSON.stringify({ hits: [{ id: '1', path: 'notes/next.md', title: 'Next thing', snippet: 's' }] })
const READ = JSON.stringify({ path: 'notes/plan.md', title: LONG, body: '> Split the importer into fetch and store' })
const pane = (surface: string) => ({
  plugin: 'memory-lens',
  component: 'Pane',
  requestId: 'memory-lens',
  surface,
  props: { title: 'memory-lens', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 6 }, view: {} },
})

async function setup($: any, on: any, recent = () => ({ value: { isError: false, content: [{ type: 'text', text: RECENT }] } })) {
  mock.store(on)
  mock.env(on, { HOME: '/home/u' })
  for (const event of ['ui.log', 'ui.toast', 'command.register', 'ui.close']) on(event, () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', (_: any, e: any) => {
    if (e.path === '/r/.ai-memory.toml') return { value: 'workspace = "w"\nproject = "p"\n' }
    throw new Error('ENOENT')
  })
  on('mcp.call', recent)
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, text: READ }))
  await $.session.start({ cwd: '/r', surface: 'desktop', isInteractive: true })
}

function texts(node: any): string[] {
  if (typeof node === 'string') return [node]
  if (node?.type === 'Text') return [flat(node)]
  return (node?.children ?? []).flatMap(texts)
}
const flat = (node: any): string => (typeof node === 'string' ? node : (node?.children ?? []).map(flat).join(''))

for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
  test(`${surface}: the surface lays the pane out, with no cell-grid padding, rules or cuts`, async ($, on) => {
    await setup($, on)
    for (let i = 0; i < 20; i++) await $.tool.call({ tool: 'mcp__ai-memory__memory_read_page', path: `notes/plan-${i}.md` })
    const ui = await $.ui.mount(pane(surface) as any)
    const all = texts(await ui.drawn())
    await ui.unmount()
    expect(all.some(t => t.includes('──'))).toBe(false)
    expect(all.some(t => /^ {2,}/.test(t))).toBe(false)
    expect(all).toContain(LONG)
    expect(all).toContain('Split the importer into fetch and store')
    expect(all).toContain('Next thing')
    expect(all.indexOf('LEFT OFF')).toBeLessThan(all.indexOf('THIS SESSION'))
  })
}

test('desktop: with ai-memory unreachable the pane says unavailable', async ($, on) => {
  await setup($, on, () => {
    throw new Error('down')
  })
  const ui = await $.ui.mount(pane('desktop') as any)
  expect(texts(await ui.drawn())).toContain('unavailable')
  await ui.unmount()
})

test('the terminal keeps its cell grid', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount(pane('terminal') as any)
  const all = texts(await ui.drawn())
  await ui.unmount()
  expect(all).toContain('─'.repeat(40))
})
