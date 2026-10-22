import { expect, mock, test } from 'claude-code/testing'

const TOML = 'workspace = "w"\nproject = "p"\n'
const PATH = '/home/u/.claude/projects/demo/session.jsonl'
const bare = JSON.stringify({ hits: [{ id: '7', path: 'notes/page-7.md', title: 'page-7', snippet: 's' }] })
const use = JSON.stringify({ type: 'assistant', timestamp: '2026-01-01T10:00:00.000Z', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__ai-memory__memory_write_page', input: { path: 'notes/a.md' } }] } })
const settle = () => new Promise(r => setTimeout(r, 20))

const answers: Record<string, () => unknown> = {
  undefined: () => ({ value: undefined }),
  throws: () => {
    throw new Error('boom')
  },
}

async function setup($: any, on: any, invalidate: () => unknown) {
  const logs: unknown[] = []
  mock.store(on)
  mock.env(on, { HOME: '/home/u' })
  on('ui.log', (_: any, e: any) => (logs.push(e), { value: undefined }))
  on('ui.invalidate', invalidate)
  for (const event of ['ui.toast', 'ui.close', 'command.register']) on(event, () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', (_: any, e: any) => {
    if (e.path === '/r/.ai-memory.toml') return { value: TOML }
    throw new Error('ENOENT')
  })
  on('mcp.call', (_: any, e: any) => ({ value: { isError: false, content: [{ type: 'text', text: JSON.stringify({ path: e.args?.path, title: 't', body: 'body' }) }] } }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'A summary', usage: {} } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: use + '\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('tool.call', () => ({ result: {}, text: bare }))
  return logs
}

for (const [mode, answer] of Object.entries(answers)) {
  test(`left-off refresh redraws without logging when invalidate ${mode}`, async ($, on) => {
    const logs = await setup($, on, answer)
    await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
    await settle()
    expect(logs).toEqual([])
  })

  test(`a backfill scan redraws without logging when invalidate ${mode}`, async ($, on) => {
    const logs = await setup($, on, answer)
    await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
    await $.classic.SessionStart({ source: 'startup', transcript_path: PATH } as any)
    await settle()
    expect(logs).toEqual([])
  })

  test(`a landing summary redraws without logging when invalidate ${mode}`, async ($, on) => {
    const logs = await setup($, on, answer)
    await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: 'mcp__ai-memory__memory_query', query: 'q' })
    await settle()
    expect(logs).toEqual([])
  })
}
