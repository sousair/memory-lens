import { expect, test } from 'claude-code/testing'

import { classifyTool, cleanLine, parseHits, parsePage, readableName, scopeFromToml } from '../hooks/memory'

const live = {
  hits: [
    {
      id: 'a',
      path: '_rules/rule_keep-tests-small.md',
      title: 'keep-tests-small',
      snippet: '> Tests should stay small and fast…',
      rank: -0.04,
    },
  ],
}

test('classifyTool', () => {
  expect(classifyTool('mcp__ai-memory__memory_query')).toBe('read')
  expect(classifyTool('mcp__ai-memory__memory_write_page')).toBe('write')
  expect(classifyTool('mcp__ai-memory__memory_handoff_accept')).toBe('handoff')
  expect(classifyTool('mcp__ai-memory__memory_status')).toBe('other')
  expect(classifyTool('Bash')).toBeNull()
})

test('parseHits', () => {
  const hits = parseHits(JSON.stringify(live))
  expect(hits.length).toBe(1)
  expect(hits[0].path).toBe(live.hits[0].path)
  expect(parseHits('not json')).toEqual([])
  expect(parseHits('{}')).toEqual([])
  const g = parseHits(JSON.stringify({ hits: [], global_scope_hits: [{ id: 'g', path: 'p.md', title: 't', snippet: 's' }] }))
  expect(g[0].project).toBe('_global')
  const kept = parseHits(JSON.stringify({ hits: [{ id: 'k', path: 'p.md', title: 't', snippet: 's', workspace: 'w', project: 'x' }] }))
  expect(kept[0].project).toBe('x')
  expect(kept[0].workspace).toBe('w')
})

test('readableName', () => {
  const hit = parseHits(JSON.stringify(live))[0]
  expect(readableName(hit)).toEqual({
    name: 'Keep tests small',
    summary: 'Tests should stay small and fast…',
    needsModel: false,
  })
  const titled = readableName({
    id: 'b',
    path: 'notes/entities/release-checklist.md',
    title: 'Release Checklist Implementation Plan',
    snippet: '…body…',
  })
  expect(titled.name).toBe('Release Checklist Implementation Plan')
  expect(titled.needsModel).toBe(false)
  expect(
    readableName({
      id: 'c',
      path: 'concepts/cache-warmup.md',
      title: 'cache-warmup',
      snippet: '…Under **cache** pressure…',
    }),
  ).toEqual({ name: 'Cache warmup', needsModel: true })
  expect(readableName({ id: 'd', path: 'x/y.md', title: 'y', snippet: '> one-line: hello' }).summary).toBe('hello')
})

test('readableName finds the summary under a leading title heading', () => {
  expect(readableName({ id: 'r', path: 'notes/release.md', title: 'Release checklist', snippet: '# Release checklist\n\n> Steps to run before every release\n\n1. …' })).toEqual({
    name: 'Release checklist',
    summary: 'Steps to run before every release',
    needsModel: false,
  })
})

test('cleanLine', () => {
  const out = cleanLine('a <mark>b</mark>\n  c' + 'x'.repeat(300))
  expect(out).not.toContain('<mark>')
  expect(out).not.toContain('\n')
  expect(out.length).toBeLessThanOrEqual(80)
  expect(out.endsWith('…')).toBe(true)
})

test('scopeFromToml', () => {
  expect(scopeFromToml('workspace = "default"\nproject = "proj"\n[capture]\nproject = "x"')).toEqual({
    workspace: 'default',
    project: 'proj',
  })
  expect(scopeFromToml('workspace = "default"\n[capture]\nproject = "x"')).toBeNull()
})

test('parsePage', () => {
  const flat = JSON.stringify({ path: 'concepts/a.md', title: 'A Title', body: 'the body', frontmatter: {} })
  const hit = parsePage({ path: 'concepts/a.md' }, flat)
  expect(hit?.path).toBe('concepts/a.md')
  expect(hit?.title).toBe('A Title')
  expect(hit?.snippet).toBe('the body')
  expect(parsePage({ path: 'concepts/a.md' }, 'not json')).toBeNull()
  expect(parsePage({}, flat)).toBeNull()
})
