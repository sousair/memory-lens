import { expect, test } from 'claude-code/testing'

const TOML = 'workspace = "w"\nproject = "p"\n'
const mk = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `${from + i}`, path: `notes/page-${from + i}.md`, title: `Page ${from + i}`, snippet: 's' }))
const answer = (text: string, extra: object = {}) => ({ result: {}, text, ...extra })

async function setup($: any, on: any, text: () => string | object) {
  const toasts: { text: string; timeoutMs?: number }[] = []
  on('ui.toast', (_: any, e: any) => (toasts.push(e), { value: undefined }))
  on('fs.read', (_: any, e: any) => {
    if (e.path === '/r/.ai-memory.toml') return { value: TOML }
    throw new Error('ENOENT')
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.log', () => ({ value: undefined }))
  on('tool.call', () => {
    const t = text()
    return typeof t === 'string' ? answer(t) : t
  })
  await $.session.start({ cwd: '/r/sub', surface: 'terminal', isInteractive: true })
  return toasts
}

const query = (n: number, from = 0) => JSON.stringify({ hits: mk(n, from) })

test('a memory_read_page toasts once with the readable name, and the same page again does not toast', async ($, on) => {
  const toasts = await setup($, on, () => JSON.stringify({ path: 'notes/a.md', title: 'Alpha plan', body: 'x' }))
  const call = { tool: 'mcp__ai-memory__memory_read_page', path: 'notes/a.md' }
  await $.tool.call(call)
  await $.tool.call(call)
  expect(toasts.length).toBe(1)
  expect(toasts[0].text).toBe('🧠 Alpha plan')
})

test('a memory_query returning 20 hits toasts exactly toastCap times and no toast says more', { options: { toastCap: 12 } }, async ($, on) => {
  const toasts = await setup($, on, () => query(20))
  await $.tool.call({ tool: 'mcp__ai-memory__memory_query', query: 'q' })
  expect(toasts.length).toBe(12)
  expect(toasts.every(t => !/more/i.test(t.text))).toBe(true)
})

test('subagent queries share the cap and only a main prompt resets it', async ($, on) => {
  let from = 0
  let size = 6
  const toasts = await setup($, on, () => query(size, (from += 6)))
  const sub = { tool: 'mcp__ai-memory__memory_query', query: 'q', agentId: 'a1' }
  for (let i = 0; i < 3; i++) await $.tool.call(sub)
  expect(toasts.length).toBe(12)
  await $.turn.complete({ agentId: 'a1', answer: 'done' } as any)
  await $.prompt.submit({ text: 'x', agentId: 'a1' } as any)
  await $.tool.call(sub)
  expect(toasts.length).toBe(12)
  await $.prompt.submit({ text: 'hello' })
  size = 1
  await $.tool.call(sub)
  expect(toasts.length).toBe(13)
})

test('a Bash call and ai-memory status calls never toast', async ($, on) => {
  const toasts = await setup($, on, () => query(3))
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'mcp__ai-memory__memory_status' })
  expect(toasts.length).toBe(0)
})

test('an errored or non-JSON memory_query passes through unchanged and does not toast', async ($, on) => {
  let next: any = answer('boom', { isError: true })
  const toasts = await setup($, on, () => next)
  const call = { tool: 'mcp__ai-memory__memory_query', query: 'q' }
  expect(await $.tool.call(call)).toEqual(answer('boom', { isError: true }))
  next = answer('not json')
  expect(await $.tool.call(call)).toEqual(answer('not json'))
  next = answer(query(3), { isError: true })
  expect(await $.tool.call(call)).toEqual(answer(query(3), { isError: true }))
  expect(toasts.length).toBe(0)
})

test('a cross-project hit is prefixed with its project', async ($, on) => {
  const toasts = await setup($, on, () => JSON.stringify({ hits: [], global_scope_hits: mk(1) }))
  await $.tool.call({ tool: 'mcp__ai-memory__memory_query', query: 'q' })
  expect(toasts[0].text.startsWith('🧠 [_global] ')).toBe(true)
})

test('toastSeconds sets the toast timeout', { options: { toastSeconds: 9 } }, async ($, on) => {
  const toasts = await setup($, on, () => query(1))
  await $.tool.call({ tool: 'mcp__ai-memory__memory_query', query: 'q' })
  expect(toasts[0].timeoutMs).toBe(9000)
})

test('concurrent queries with overlapping hits toast at most the cap and never a page twice', { options: { toastCap: 12 } }, async ($, on) => {
  let from = 0
  const toasts = await setup($, on, () => query(8, (from += 4)))
  const call = { tool: 'mcp__ai-memory__memory_query', query: 'q' }
  await Promise.all([1, 2, 3, 4].map(() => $.tool.call(call)))
  expect(toasts.length).toBe(12)
  expect(new Set(toasts.map(t => t.text)).size).toBe(12)
})

test('a nearer marker missing project falls through to the parent marker', async ($, on) => {
  const toasts: any[] = []
  on('ui.toast', (_: any, e: any) => (toasts.push(e), { value: undefined }))
  on('fs.read', (_: any, e: any) => {
    if (e.path === '/r/sub/.ai-memory.toml') return { value: 'workspace = "w"\n' }
    if (e.path === '/r/.ai-memory.toml') return { value: TOML }
    throw new Error('ENOENT')
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('ui.log', () => ({ value: undefined }))
  on('tool.call', () => answer(JSON.stringify({ hits: [{ id: '1', path: 'a.md', title: 'A', snippet: 's', workspace: 'w', project: 'p' }] })))
  await $.session.start({ cwd: '/r/sub', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__ai-memory__memory_query', query: 'q' })
  expect(toasts[0].text).toBe('🧠 A')
})

test('a global query toasts global_hits, prefixed with their project', async ($, on) => {
  const entry = (project: string, n: number) => ({ workspace_name: 'default', project_name: project, path: `_rules/rule_example-${n}.md`, title: `Example title ${n}`, snippet: '> Example summary', rank: -1 })
  const toasts = await setup($, on, () => JSON.stringify({ hits: [], global_hits: [entry('alpha', 1), entry('beta', 2)] }))
  await $.tool.call({ tool: 'mcp__ai-memory__memory_query', query: 'q', global: true })
  expect(toasts.map(t => t.text)).toEqual(['🧠 [alpha] Example title 1 — Example summary', '🧠 [beta] Example title 2 — Example summary'])
})

test('a query scoped to another project prefixes hits that carry no project', async ($, on) => {
  const toasts = await setup($, on, () => query(1))
  await $.tool.call({ tool: 'mcp__ai-memory__memory_query', query: 'q', workspace: 'w', project: 'beta' })
  expect(toasts[0].text).toBe('🧠 [beta] Page 0')
})

test('a toast joins name and summary with a dash on one line', async ($, on) => {
  const toasts = await setup($, on, () => JSON.stringify({ hits: [{ id: '1', path: 'a/b.md', title: 'Example title', snippet: '> Example summary' }] }))
  await $.tool.call({ tool: 'mcp__ai-memory__memory_query', query: 'q' })
  expect(toasts[0].text).toContain(' — ')
  expect(toasts[0].text).not.toContain('\n')
})
