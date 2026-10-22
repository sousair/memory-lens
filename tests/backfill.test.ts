import { expect, mock, test } from 'claude-code/testing'

import { draw } from './render'

const TOML = 'workspace = "w"\nproject = "p"\n'
const PATH = '/home/u/.claude/projects/demo/session.jsonl'
const PANE = {
  plugin: 'memory-lens',
  component: 'Pane',
  requestId: 'memory-lens',
  surface: 'terminal',
  props: { title: 'memory-lens', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const use = (id: string, name: string, input: object, timestamp: string, isSidechain = false) =>
  JSON.stringify({ type: 'assistant', timestamp, isSidechain, message: { content: [{ type: 'tool_use', id, name, input }] } })
const result = (id: string, text: string) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] } })

const HISTORY = [
  use('t1', 'mcp__ai-memory__memory_query', { query: 'demo' }, '2026-01-01T10:00:00.000Z'),
  result('t1', JSON.stringify({ hits: [{ id: '1', path: 'notes/release.md', title: 'Release checklist', snippet: '> Steps before a release' }] })),
  use('t2', 'mcp__ai-memory__memory_write_page', { path: 'notes/deploy.md', title: 'Deploy notes' }, '2026-01-01T10:01:00.000Z'),
  result('t2', 'saved'),
  use('t3', 'mcp__ai-memory__memory_read_page', { path: 'notes/plan.md' }, '2026-01-01T10:02:00.000Z', true),
  result('t3', JSON.stringify({ path: 'notes/plan.md', title: 'Importer plan', body: '> Split the importer' })),
]

type Run = { exitCode: number; stdout: string } | Error
type Opts = { history?: string[]; run?: () => Run; cap?: number }

// Stands for grep -F over the fixture: patterns from -e, -f - (stdin) or the lone argument; output cut at `cap` bytes like process.run's limit.
function fakeGrep(history: string[], e: any, cap: number): Run {
  const args = e.argv.slice(2, -1) as string[]
  const patterns = args[0] === '-f' ? String(e.init?.stdin ?? '').split('\n').filter(Boolean) : args.filter((a, i) => a !== '-e' && (args.length === 1 || args[i - 1] === '-e'))
  const hits = history.filter(line => patterns.some(p => line.includes(p)))
  return hits.length ? { exitCode: 0, stdout: (hits.join('\n') + '\n').slice(0, cap) } : { exitCode: 1, stdout: '' }
}

const scans = (runs: any[]) => runs.filter(r => r.argv[2] === 'mcp__ai-memory__').length
const settle = () => new Promise(r => setTimeout(r, 20))

async function setup($: any, on: any, opts: Opts = {}) {
  const runs: any[] = []
  const toasts: string[] = []
  const opens: string[] = []
  const logs: string[] = []
  mock.env(on, { HOME: '/home/u' })
  on('ui.log', (_: any, e: any) => (logs.push(String(e.text ?? e.message ?? JSON.stringify(e))), { value: undefined }))
  on('ui.toast', (_: any, e: any) => (toasts.push(e.text), { value: undefined }))
  on('ui.open', (_: any, e: any) => (opens.push(e.id), { value: { isPlaced: true } }))
  for (const event of ['ui.close', 'ui.invalidate', 'command.register']) on(event, () => ({ value: undefined }))
  on('fs.read', (_: any, e: any) => {
    if (e.path === '/r/.ai-memory.toml') return { value: TOML }
    throw new Error('ENOENT')
  })
  on('mcp.call', () => ({ value: { isError: false, content: [{ type: 'text', text: '{"hits":[]}' }] } }))
  on('process.run', (_: any, e: any) => {
    runs.push(e)
    const out = opts.run?.() ?? fakeGrep(opts.history ?? HISTORY, e, opts.cap ?? Infinity)
    if (out instanceof Error) throw out
    return { value: { ...out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('command.run', () => ({}))
  on('classic.SessionStart', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  on('tool.call', (_: any, e: any) => ({ result: {}, text: e.tool.endsWith('read_page') ? JSON.stringify({ path: e.path, title: 'Importer plan', body: '> Split the importer' }) : 'saved' }))
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
  return { runs, toasts, opens, logs }
}

async function session($: any) {
  const ui = await $.ui.mount(PANE as any)
  const drawn = draw(await ui.drawn(), PANE.props.bodyColumns)
  await ui.unmount()
  const at = drawn.findIndex(l => l.startsWith('THIS SESSION'))
  const end = drawn.findIndex(l => l.startsWith('LEFT OFF'))
  return drawn.slice(at, end).filter(l => l !== '')
}

const start = async ($: any, transcript_path = PATH) => {
  await $.classic.SessionStart({ source: 'startup', transcript_path } as any)
  await settle()
}
const prompt = async ($: any, transcript_path = PATH) => {
  await $.classic.UserPromptSubmit({ prompt: 'x', transcript_path } as any)
  await settle()
}

test('history calls become rows newest first, with names and summaries, and never toast or open the pane', async ($, on) => {
  const { runs, toasts, opens } = await setup($, on)
  await start($)
  expect(runs.map(r => r.argv)).toEqual([
    ['grep', '-F', 'mcp__ai-memory__', PATH],
    ['grep', '-F', '-f', '-', PATH],
  ])
  const rows = await session($)
  expect(rows[0]).toMatch(/^THIS SESSION +1 query · 2 reads · 1 saved$/)
  expect(rows.slice(1).map(r => r.replace(/^\s*\d\d:\d\d /, '').trim())).toEqual([
    'read    Importer plan',
    'Split the importer',
    'saved   Deploy notes',
    'query   "demo"',
    'Release checklist',
    'Steps before a release',
  ])
  expect(toasts).toEqual([])
  expect(opens).toEqual([])
})

test('a second trigger does not scan again', async ($, on) => {
  const { runs } = await setup($, on)
  await start($)
  await prompt($)
  await $.command.run({ command: 'mem' } as any)
  expect(scans(runs)).toBe(1)
  expect((await session($))[0]).toMatch(/2 reads · 1 saved$/)
})

test('the first prompt scans when session start carried no transcript', async ($, on) => {
  const { runs } = await setup($, on)
  await start($, '')
  await prompt($)
  expect(scans(runs)).toBe(1)
  expect((await session($))[0]).toMatch(/2 reads · 1 saved$/)
})

test('opening the pane after the session reset its rows scans again', async ($, on) => {
  const { runs } = await setup($, on)
  await start($)
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'mem' } as any)
  expect(scans(runs)).toBe(2)
  expect((await session($))[0]).toMatch(/2 reads · 1 saved$/)
})

test('a live call with a scanned tool_use_id is not added twice', async ($, on) => {
  await setup($, on)
  await start($)
  await $.tool.call({ tool: 'mcp__ai-memory__memory_write_page', path: 'notes/deploy.md', title: 'Deploy notes', tool_use_id: 't2' } as any)
  expect((await session($))[0]).toMatch(/2 reads · 1 saved$/)
})

test('a scan after a live call does not add that call again', async ($, on) => {
  await setup($, on)
  await start($, '')
  await $.tool.call({ tool: 'mcp__ai-memory__memory_write_page', path: 'notes/deploy.md', title: 'Deploy notes', tool_use_id: 't2' } as any)
  await prompt($)
  expect((await session($))[0]).toMatch(/2 reads · 1 saved$/)
})

test('a live re-read of a page read in history does not toast', async ($, on) => {
  const { toasts } = await setup($, on)
  await start($)
  await $.tool.call({ tool: 'mcp__ai-memory__memory_read_page', path: 'notes/plan.md', tool_use_id: 'live-1' } as any)
  expect(toasts).toEqual([])
})

test('a transcript outside ~/.claude/projects is never read', async ($, on) => {
  const { runs } = await setup($, on)
  await start($, '/tmp/session.jsonl')
  await start($, '/home/u/.claude/projects/../secret.jsonl')
  await prompt($, '/home/u/other/session.jsonl')
  expect(runs).toEqual([])
})

for (const [name, run] of [
  ['no matches', () => ({ exitCode: 1, stdout: '' })],
  ['a missing file', () => ({ exitCode: 2, stdout: '' })],
  ['a failed command', () => new Error('timed out')],
] as const) {
  test(`${name} adds no rows and logs nothing`, async ($, on) => {
    const { runs, logs } = await setup($, on, { run })
    await start($)
    expect(runs.length).toBe(1)
    expect((await session($))[0]).toMatch(/^THIS SESSION *$/)
    expect(logs).toEqual([])
  })
}

test('a transcript full of other tool results still yields the newest call, and the second pass asks only for ai-memory ids', async ($, on) => {
  const noise = Array.from({ length: 200 }, (_, i) => result(`bash-${i}`, 'x'.repeat(100)))
  const history = [...HISTORY.slice(0, 2), ...noise, use('t9', 'mcp__ai-memory__memory_write_page', { path: 'notes/newest.md', title: 'Newest notes' }, '2026-01-01T11:00:00.000Z'), result('t9', 'saved')]
  const { runs } = await setup($, on, { history, cap: 4000 })
  await start($)
  expect((await session($))[1]).toMatch(/saved +Newest notes$/)
  expect(runs[1].init.stdin).toBe('"tool_use_id":"t1"\n"tool_use_id":"t9"\n')
})

test('history keeps the newest 200 rows and never evicts a live one', async ($, on) => {
  const history = Array.from({ length: 250 }, (_, i) => use(`h${i}`, 'mcp__ai-memory__memory_write_page', { path: `notes/old-${i}.md` }, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()))
  await setup($, on, { history })
  await start($, '')
  await $.tool.call({ tool: 'mcp__ai-memory__memory_write_page', path: 'notes/live.md', title: 'Live page', tool_use_id: 'live-1' } as any)
  await prompt($)
  const rows = await session($)
  expect(rows[0]).toMatch(/200 saved$/)
  expect(rows[1]).toMatch(/saved +Live page$/)
  expect(rows[2]).toMatch(/saved +Old 249$/)
})

test('a history call scoped to another project is tagged with it', async ($, on) => {
  await setup($, on, { history: [use('t9', 'mcp__ai-memory__memory_write_page', { workspace: 'w', project: 'other', path: 'notes/x.md', title: 'Other notes' }, '2026-01-01T10:00:00.000Z')] })
  await start($)
  expect((await session($))[1]).toMatch(/saved +\[other\] Other notes$/)
})
