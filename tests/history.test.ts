import { expect, test } from 'claude-code/testing'

import { parseTranscript } from '../hooks/history'

const use = (id: string, name: string, input: object, timestamp: string, isSidechain = false) =>
  JSON.stringify({ type: 'assistant', timestamp, isSidechain, message: { content: [{ type: 'tool_use', id, name, input }] } })

const result = (id: string, content: unknown, extra: object = {}) =>
  JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, ...extra }] } })

const T1 = '2026-01-01T10:00:00.000Z'
const T2 = '2026-01-01T10:00:05.000Z'

test('memory_query use with list content result', () => {
  const calls = parseTranscript([
    use('t1', 'mcp__ai-memory__memory_query', { query: 'demo' }, T1),
    result('t1', [
      { type: 'text', text: '{"hits":' },
      { type: 'text', text: '[]}' },
    ]),
  ])
  expect(calls).toEqual([
    { toolUseId: 't1', at: Date.parse(T1), tool: 'mcp__ai-memory__memory_query', input: { query: 'demo' }, resultText: '{"hits":[]}', isError: false, isSidechain: false },
  ])
})

test('string result, error flag, missing result, sidechain', () => {
  const calls = parseTranscript([
    use('a', 'mcp__ai-memory__memory_write_page', { path: 'p.md' }, T1),
    result('a', 'saved'),
    use('b', 'mcp__ai-memory__memory_read_page', { path: 'q.md' }, T2, true),
    use('c', 'mcp__ai-memory__memory_query', {}, T2),
    result('c', 'boom', { is_error: true }),
  ])
  expect(calls.map(c => c.resultText)).toEqual(['saved', undefined, 'boom'])
  expect(calls.map(c => c.isError)).toEqual([false, false, true])
  expect(calls.map(c => c.isSidechain)).toEqual([false, true, false])
})

test('ignores other tools and garbage lines', () => {
  expect(parseTranscript(['not json', '', use('x', 'Bash', {}, T1), '{"type":"assistant"}'])).toEqual([])
})

test('sorts by time', () => {
  const calls = parseTranscript([use('late', 'mcp__ai-memory__memory_query', {}, T2), use('early', 'mcp__ai-memory__memory_query', {}, T1)])
  expect(calls.map(c => c.toolUseId)).toEqual(['early', 'late'])
})

test('skips a call whose timestamp does not parse', () => {
  const calls = parseTranscript([use('bad', 'mcp__ai-memory__memory_query', {}, 'not a time'), use('none', 'mcp__ai-memory__memory_query', {}, undefined as any), use('ok', 'mcp__ai-memory__memory_query', {}, T1)])
  expect(calls.map(c => c.toolUseId)).toEqual(['ok'])
})
