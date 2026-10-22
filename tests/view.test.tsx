import { expect, mock, test } from 'claude-code/testing'

import { draw, widthOf } from './render'

const TOML = 'workspace = "w"\nproject = "p"\n'
const pane = (bodyColumns: number, bodyRows: number, surface = 'terminal') => ({
  plugin: 'memory-lens',
  component: 'Pane',
  requestId: 'memory-lens',
  surface,
  props: { title: 'memory-lens', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows }, view: {} },
})
const RULES = [
  'Keep tests small',
  'Name things plainly and never abbreviate the domain words',
  'Prefer plain errors',
  'Check the cache first',
  'One change per commit',
  'Read before writing',
  'Measure before tuning',
  'Leave the docs current',
]
const BRIEF = ['> 🧭 **ai-memory: project brief** (auto-injected)', '', ...RULES.map((r, i) => `## ${r} 📌 (\`_rules/rule_${i}.md\`)`)].join('\n')
const HANDOFF = '📥 ai-memory: pending handoff\n\nFinish the importer next.'
const hit = (path: string, title: string, snippet: string, extra: object = {}) => ({ id: path, path, title, snippet, ...extra })
const QUERY = JSON.stringify({
  hits: [hit('notes/deploy.md', 'Deploy checklist', '> Steps to follow before every release goes out to the live environment and gets watched', { project: 'p' })],
  global_scope_hits: [hit('_rules/rule_safety.md', 'Ship behind a safety net', '> Migrations need a safety net first')],
})
const READ = JSON.stringify({ path: 'notes/plan.md', title: 'Importer plan', body: '> Split the importer into fetch and store' })

type Opts = { recent?: (e: any) => any; context?: string[]; recentCalls?: any[]; project?: string; query?: string; toasts?: string[] }

async function setup($: any, on: any, opts: Opts = {}) {
  mock.store(on)
  mock.env(on, { HOME: '/home/u' })
  for (const event of ['ui.log', 'command.register', 'ui.close']) on(event, () => ({ value: undefined }))
  on('ui.toast', (_: any, e: any) => (opts.toasts?.push(e.text), { value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', (_: any, e: any) => {
    if (e.path === '/r/.ai-memory.toml') return { value: opts.project ? `workspace = "w"\nproject = "${opts.project}"\n` : TOML }
    throw new Error('ENOENT')
  })
  on('mcp.call', (_: any, e: any) => {
    opts.recentCalls?.push(e)
    return opts.recent?.(e) ?? { value: { isError: false, content: [{ type: 'text', text: '{"hits":[]}' }] } }
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 's' }))
  on('classic.SessionStart', () => ({ additionalContext: opts.context ?? [] }))
  on('tool.call', (_: any, e: any) => ({ result: {}, text: e.tool.endsWith('memory_query') ? (opts.query ?? QUERY) : e.tool.endsWith('read_page') ? READ : '{}' }))
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
}

async function lines($: any, columns = 46, rows = 24, styled = false) {
  const ui = await $.ui.mount(pane(columns, rows) as any)
  const drawn = draw(await ui.drawn(), columns, styled)
  await ui.unmount()
  return drawn
}

const recentOf = (paths: string[]) => () => ({ value: { isError: false, content: [{ type: 'text', text: JSON.stringify({ hits: paths.map(p => hit(p, `Title of ${p}`, 's')) }) }] } })

test('the title row shows the session project on the right and a rule under it', async ($, on) => {
  await setup($, on)
  const [title, rule] = await lines($)
  expect(title).toMatch(/^🧠 memory-lens +p$/)
  expect(widthOf(title)).toBe(46)
  expect(rule).toBe('─'.repeat(46))
})

test('left off skips session pages and takes the newest other page of five', async ($, on) => {
  const recentCalls: any[] = []
  await setup($, on, { recentCalls, recent: recentOf(['sessions/0f1e.md', 'sessions/9a8b.md', 'notes/next.md']) })
  const all = await lines($)
  expect(all[all.findIndex(l => l.startsWith('LEFT OFF')) + 1]).toBe(' Title of notes/next.md')
  expect(JSON.stringify(recentCalls)).toContain('"limit":5')
})

test('left off reads nothing carried over when only session pages are recent', async ($, on) => {
  await setup($, on, { recent: recentOf(['sessions/0f1e.md']) })
  const all = await lines($, 46, 24, true)
  expect(all[all.findIndex(l => l.includes('LEFT OFF')) + 1]).toBe(' {dim}nothing carried over{/}')
})

test('at start shows at most three rows even with room to spare, and still counts every rule', async ($, on) => {
  await setup($, on, { context: [BRIEF, HANDOFF] })
  await $.classic.SessionStart({ source: 'startup' })
  const all = await lines($, 46, 40)
  const at = all.findIndex(l => l.startsWith('AT START'))
  expect(all[at]).toMatch(/ 8 rules$/)
  expect(all.slice(at + 1, at + 5)).toEqual([' 📥 Finish the importer next.', ' 📌 Keep tests small', ' 📌 Name things plainly and never abbreviate…', ''])
})

test('headers and the title row stay on one row within the pane width', async ($, on) => {
  await setup($, on, { project: 'a-project-name-long-enough-to-crowd-the-title-row' })
  for (const tool of ['memory_read_page', 'memory_write_page', 'memory_delete_page', 'memory_handoff_begin']) await $.tool.call({ tool: `mcp__ai-memory__${tool}`, path: 'notes/plan.md' })
  const all = await lines($)
  const at = all.findIndex(l => l.startsWith('THIS SESSION'))
  for (const l of [all[0], all[at]]) expect(widthOf(l)).toBeLessThanOrEqual(46)
  expect(all[0]).toBe('🧠 memory-lens a-project-name-long-enough-to-…')
  expect(all[at]).toMatch(/^THIS SESSION +1 read · 1 saved · 1 removed …$/)
  expect(all[at + 1]).toMatch(/^ \d\d:\d\d handoff begin$/)
})

test('a 10-row pane gives its rows to content before blank separators', async ($, on) => {
  await setup($, on, { context: [BRIEF, HANDOFF] })
  await $.classic.SessionStart({ source: 'startup' })
  for (let i = 0; i < 4; i++) await $.tool.call({ tool: 'mcp__ai-memory__memory_read_page', path: 'notes/plan.md' })
  const all = await lines($, 46, 10)
  expect(all.length).toBe(10)
  expect(all).not.toContain('')
  const at = all.findIndex(l => l.startsWith('THIS SESSION'))
  expect(all[at + 1]).toMatch(/^ \d\d:\d\d read +Importer plan$/)
  expect(all[at + 4]).toBe('LEFT OFF')
})

test('left off does not repeat the handoff already shown at start', async ($, on) => {
  await setup($, on, { context: [HANDOFF], recent: recentOf(['sessions/0f1e.md', 'notes/next.md']) })
  await $.classic.SessionStart({ source: 'startup' })
  const all = await lines($)
  expect(all).toContain(' 📥 Finish the importer next.')
  expect(all[all.findIndex(l => l.startsWith('LEFT OFF')) + 1]).toBe(' Title of notes/next.md')
})

test('rows are newest first, colored by verb, tagged by foreign project, with a dim wrapped summary', async ($, on) => {
  await setup($, on)
  await $.tool.call({ tool: 'mcp__ai-memory__memory_query', query: 'q' })
  await $.tool.call({ tool: 'mcp__ai-memory__memory_write_page', path: 'notes/a.md' })
  const all = await lines($, 46, 30, true)
  const at = all.findIndex(l => l.includes('THIS SESSION'))
  const rows = all.slice(at + 1, all.findIndex(l => l.includes('LEFT OFF')) - 1)
  expect(all[at]).toMatch(/\{dim\}1 query · 2 reads · 1 saved\{\/\}$/)
  expect(rows[0]).toMatch(/^ \{dim\}\d\d:\d\d\{\/\} \{green\}saved\{\/\}   A$/)
  expect(rows[1]).toMatch(/^ \{dim\}\d\d:\d\d\{\/\} \{yellow\}query\{\/\}   "q"$/)
  expect(rows.slice(2)).toEqual([
    '                 Deploy checklist',
    '                 {dim}Steps to follow before every{/}',
    '                 {dim}release goes out to the live…{/}',
    '                 {dim}[_global]{/} Ship behind a safe…',
    '                 {dim}Migrations need a safety net{/}',
    '                 {dim}first{/}',
  ])
})

test('an empty session still shows a row under its header', async ($, on) => {
  await setup($, on)
  const all = await lines($)
  const at = all.findIndex(l => l.startsWith('THIS SESSION'))
  expect(all[at].trim()).toBe('THIS SESSION')
  expect(all[at + 1]).toBe(' no memory calls yet')
})

test('a short pane keeps the title and newest rows and never leaves a header without a row', async ($, on) => {
  await setup($, on, { context: [BRIEF, HANDOFF] })
  for (let i = 0; i < 4; i++) await $.tool.call({ tool: 'mcp__ai-memory__memory_read_page', path: 'notes/plan.md' })
  for (const rows of [3, 4, 6, 8, 12]) {
    const all = await lines($, 46, rows)
    expect(all.length).toBeLessThanOrEqual(rows)
    expect(all[0]).toMatch(/^🧠 memory-lens/)
    for (const [i, l] of all.entries()) {
      if (/^(AT START|THIS SESSION|LEFT OFF)/.test(l)) expect(all[i + 1]?.trim()).toBeTruthy()
      expect(widthOf(l)).toBeLessThanOrEqual(46)
    }
    if (rows >= 4) expect(all.some(l => l.startsWith('THIS SESSION'))).toBe(true)
  }
})

test('prints the pane at 46x24 and 46x12', async ($, on) => {
  await setup($, on, { context: [BRIEF, HANDOFF] })
  await $.tool.call({ tool: 'mcp__ai-memory__memory_write_page', path: 'notes/a.md' })
  await $.tool.call({ tool: 'mcp__ai-memory__memory_handoff_begin' })
  await $.session.end({ reason: 'other', sessionId: 's', resume: { id: 's' } } as any)
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
  await $.classic.SessionStart({ source: 'startup' })
  await $.tool.call({ tool: 'mcp__ai-memory__memory_query', query: 'q' })
  await $.tool.call({ tool: 'mcp__ai-memory__memory_read_page', path: 'notes/plan.md', workspace: 'w', project: 'other' })
  await $.tool.call({ tool: 'mcp__ai-memory__memory_read_page', path: 'notes/plan.md' })
  await $.tool.call({ tool: 'mcp__ai-memory__memory_write_page', path: 'notes/importer-notes.md' })
  await $.tool.call({ tool: 'mcp__ai-memory__memory_delete_page', path: 'notes/old-plan.md' })
  for (const rows of [24, 12, 10]) {
    const all = await lines($, 46, rows, true)
    expect(all.length).toBeLessThanOrEqual(rows)
    const startAt = all.findIndex(l => l.includes('AT START'))
    expect(all[startAt]).toMatch(/\{dim\}8 rules\{\/\}$/)
    expect(all.slice(startAt + 1).findIndex(l => !/^ (📥|📌)/.test(l))).toBeLessThanOrEqual(3)
    expect(all.filter(l => l.includes('{blue}read{/}')).length).toBe(rows === 24 ? 2 : 1)
  }
})

test('a page read in two calls renders one row, while the header still counts both reads', async ($, on) => {
  await setup($, on)
  await $.tool.call({ tool: 'mcp__ai-memory__memory_read_page', path: 'notes/plan.md' })
  await $.tool.call({ tool: 'mcp__ai-memory__memory_read_page', path: 'notes/plan.md' })
  const all = await lines($, 46, 30)
  const at = all.findIndex(l => l.startsWith('THIS SESSION'))
  expect(all[at]).toMatch(/2 reads/)
  const rows = all.slice(at + 1, all.findIndex(l => l.startsWith('LEFT OFF')) - 1)
  expect(rows.filter(l => l.includes('Importer plan')).length).toBe(1)
  expect(rows.filter(l => l.includes('Split the importer')).length).toBe(1)
})

test('a saved page from another project carries its project tag', async ($, on) => {
  await setup($, on)
  await $.tool.call({ tool: 'mcp__ai-memory__memory_write_page', path: 'notes/a.md', workspace: 'w', project: 'beta' })
  const all = await lines($, 46, 30)
  expect(all.some(l => /^ \d\d:\d\d saved +\[beta\] A$/.test(l))).toBe(true)
})

const THREE = JSON.stringify({
  hits: [
    hit('notes/release.md', 'Release checklist', '# Release checklist\n\n> Steps to run before every release'),
    hit('notes/plan.md', 'Importer plan', '> Split the importer into fetch and store'),
    hit('notes/release.md', 'Release checklist', '> Steps to run before every release'),
    hit('notes/style.md', 'Style guide', '> Name things plainly', { project: 'beta' }),
  ],
})

test('a query renders as one header row with its hits indented beneath, de-duped within the query', async ($, on) => {
  await setup($, on, { query: THREE })
  await $.tool.call({ tool: 'mcp__ai-memory__memory_query', query: 'how do we cut a release and keep the importer apart' })
  await $.tool.call({ tool: 'mcp__ai-memory__memory_read_page', path: 'notes/plan.md' })
  await $.tool.call({ tool: 'mcp__ai-memory__memory_write_page', path: 'notes/a.md' })
  const all = await lines($, 46, 30, true)
  const at = all.findIndex(l => l.includes('THIS SESSION'))
  const rows = all.slice(at + 1, all.findIndex(l => l.includes('LEFT OFF')) - 1)
  expect(all[at]).toMatch(/\{dim\}1 query · 4 reads · 1 saved\{\/\}$/)
  expect(rows[0]).toMatch(/^ \{dim\}\d\d:\d\d\{\/\} \{green\}saved\{\/\}   A$/)
  expect(rows[1]).toMatch(/^ \{dim\}\d\d:\d\d\{\/\} \{blue\}read\{\/\}    Importer plan$/)
  expect(rows[2]).toBe('               {dim}Split the importer into fetch{/}')
  expect(rows[3]).toBe('               {dim}and store{/}')
  expect(rows[4]).toMatch(/^ \{dim\}\d\d:\d\d\{\/\} \{yellow\}query\{\/\}   "how do we cut a release and…"$/)
  expect(widthOf(rows[4].replace(/\{[^}]*\}/g, ''))).toBeLessThanOrEqual(46)
  expect(rows.slice(5)).toEqual([
    '                 Release checklist',
    '                 {dim}Steps to run before every{/}',
    '                 {dim}release{/}',
    '                 Importer plan',
    '                 {dim}Split the importer into fetch{/}',
    '                 {dim}and store{/}',
    '                 {dim}[beta]{/} Style guide',
    '                 {dim}Name things plainly{/}',
  ])
})

test('a short pane keeps a query header with the children that fit, never a child alone', async ($, on) => {
  await setup($, on, { query: THREE })
  await $.tool.call({ tool: 'mcp__ai-memory__memory_query', query: 'release' })
  for (const [rows, child] of [[6, undefined], [7, '                 Release checklist']]) {
    const all = await lines($, 46, rows)
    const at = all.findIndex(l => l.startsWith('THIS SESSION'))
    expect(all[at + 1]).toMatch(/^ \d\d:\d\d query +"release"$/)
    expect(all[at + 2]).toBe(child)
  }
})

test('session pages never toast, become rows or count', async ($, on) => {
  const toasts: string[] = []
  const session = (id: string) => hit(`sessions/${id}.md`, 'tool unknown', '> first prompt of a session')
  const query = JSON.stringify({ hits: [hit('notes/one.md', 'Page one', '> s'), session('0f1e'), hit('notes/two.md', 'Page two', '> s'), session('9a8b')], global_scope_hits: [session('7c6d')] })
  await setup($, on, { query, toasts })
  await $.tool.call({ tool: 'mcp__ai-memory__memory_query', query: 'q' })
  expect(toasts).toEqual(['🧠 Page one — s', '🧠 Page two — s'])
  const all = await lines($, 46, 30)
  const at = all.findIndex(l => l.startsWith('THIS SESSION'))
  expect(all[at]).toMatch(/ 1 query · 2 reads$/)
  const rows = all.slice(at + 1, all.findIndex(l => l.startsWith('LEFT OFF')) - 1)
  expect(rows.filter(l => /Page (one|two)/.test(l)).length).toBe(2)
  expect(rows.some(l => /tool unknown|first prompt/.test(l))).toBe(false)
})
