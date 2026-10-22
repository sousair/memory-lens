import type { Activity, ActivityPage, Injected, Scope, ToolKind } from '../types'

export type Hit = { id: string; path: string; title: string; snippet: string; workspace?: string; project?: string }

const PREFIX = 'mcp__ai-memory__'
const KINDS: Record<string, ToolKind> = {
  memory_read_page: 'read',
  memory_query: 'read',
  memory_write_page: 'write',
  memory_delete_page: 'write',
  memory_handoff_begin: 'handoff',
  memory_handoff_accept: 'handoff',
}

export function classifyTool(tool: string): ToolKind | null {
  if (!tool.startsWith(PREFIX)) return null
  return KINDS[tool.slice(PREFIX.length)] ?? 'other'
}

type Fallback = { workspace?: string; project?: string }

function toHit(raw: any, fallback: Fallback = {}): Hit | null {
  if (!raw || typeof raw !== 'object' || typeof raw.path !== 'string') return null
  const hit: Hit = {
    id: String(raw.id ?? raw.path),
    path: raw.path,
    title: String(raw.title ?? ''),
    snippet: String(raw.snippet ?? ''),
  }
  const workspace = raw.workspace ?? raw.workspace_name
  const project = raw.project ?? raw.project_name
  if (typeof project === 'string') {
    hit.project = project
    if (typeof workspace === 'string') hit.workspace = workspace
  } else {
    if (fallback.workspace) hit.workspace = fallback.workspace
    if (fallback.project) hit.project = fallback.project
  }
  return hit
}

function json(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// A tool call that names its own workspace and project scopes every hit that carries none.
export function inputScope(input: Record<string, unknown>): Fallback {
  return typeof input.workspace === 'string' && typeof input.project === 'string' ? { workspace: input.workspace, project: input.project } : {}
}

// Session pages are titled with that session's first prompt, which names no stored knowledge.
export function parseHits(text: string, fallback: Fallback = {}): Hit[] {
  const data = json(text)
  if (!data || typeof data !== 'object') return []
  const own: unknown[] = Array.isArray(data.hits) ? data.hits : []
  const standing: unknown[] = Array.isArray(data.global_scope_hits) ? data.global_scope_hits : []
  const everywhere: unknown[] = Array.isArray(data.global_hits) ? data.global_hits : []
  return [...own.map(h => toHit(h, fallback)), ...standing.map(h => toHit(h, { project: '_global' })), ...everywhere.map(h => toHit(h))].filter((h): h is Hit => h !== null && !h.path.startsWith('sessions/'))
}

export function parsePage(input: Record<string, unknown>, text: string): Hit | null {
  if (typeof input.path !== 'string') return null
  const data = json(text)
  if (!data || typeof data !== 'object') return null
  const page = data.page ?? data
  const body = page.body ?? page.content ?? page.snippet
  return toHit({ id: page.id, path: input.path, title: page.title, snippet: typeof body === 'string' ? body : '' }, inputScope(input))
}

export function pageKey(hit: Hit, scope: Scope | null): string {
  return `${hit.workspace ?? scope?.workspace ?? ''}/${hit.project ?? scope?.project ?? ''}/${hit.path}`
}

export const summaryKey = (key: string, hit: Hit) => `${key}@${hit.id}`

export function hitsFor(tool: string, input: Record<string, unknown>, resultText: string, isError: boolean): Hit[] {
  if (classifyTool(tool) !== 'read' || isError) return []
  if (tool.endsWith('memory_query')) return parseHits(resultText, inputScope(input))
  return [parsePage(input, resultText)].filter((h): h is Hit => h !== null)
}

// Callers pass only ai-memory tools, which classifyTool always names.
export function rowFor(tool: string, input: Record<string, unknown>, resultText: string, isError: boolean, scope: Scope | null, at: number, toolUseId?: string, agentId?: string): Activity {
  const kind = classifyTool(tool) as ToolKind
  const row: Activity = { at, kind, tool, agentId, isError }
  if (toolUseId) row.toolUseId = toolUseId
  if (tool.endsWith('memory_query') && typeof input.query === 'string') row.query = input.query
  const pages: ActivityPage[] = hitsFor(tool, input, resultText, isError).map(hit => {
    const key = pageKey(hit, scope)
    const { name, summary } = readableName(hit)
    return { name, summaryKey: summaryKey(key, hit), summary, project: hit.project, key }
  })
  if (pages.length) row.pages = pages
  else if (kind === 'write' && typeof input.path === 'string') row.pages = [{ name: readableName({ id: input.path, path: input.path, title: String(input.title ?? ''), snippet: '' }).name, summaryKey: '', project: inputScope(input).project }]
  return row
}

// The guard checks the path text only: a symlink inside ~/.claude/projects would still be followed.
export async function isClaudeProjectFile($: any, path: unknown): Promise<boolean> {
  if (typeof path !== 'string' || path.split('/').includes('..')) return false
  const home = ((await $.env.get('HOME').catch(() => '')) ?? '').replace(/\/+$/, '')
  return Boolean(home) && path.startsWith(`${home}/.claude/projects/`)
}

// ui.invalidate returns nothing on the real engine and a promise in some kits; a redraw is best-effort.
export function redraw($: any): void {
  try {
    const pending = $.ui.invalidate('ui.render')
    if (typeof pending?.catch === 'function') pending.catch(() => {})
  } catch {}
}

export function cleanLine(s: string, max = 80): string {
  const line = s.replace(/<\/?mark>/g, '').replace(/\s+/g, ' ').trim()
  return line.length > max ? line.slice(0, max - 1).trimEnd() + '…' : line
}

function baseName(path: string): string {
  const file = path.split('/').pop() ?? path
  return file.replace(/\.md$/, '').replace(/^rule_/, '').replace(/[-_]/g, ' ')
}

export function readableName(hit: Hit): { name: string; summary?: string; needsModel: boolean } {
  const slug = baseName(hit.path)
  const title = cleanLine(hit.title)
  const hasTitle = title !== '' && title.replace(/[-_]/g, ' ').toLowerCase() !== slug.toLowerCase()
  const body = hit.snippet.replace(/^\s*(# [^\n]*)?\s*/, '')
  const summary = body.startsWith('>') ? cleanLine(body.split('\n')[0].replace(/^>\s*(one-line:\s*)?/, '')) : undefined
  const name = hasTitle ? title : slug.charAt(0).toUpperCase() + slug.slice(1)
  return summary ? { name, summary, needsModel: false } : { name, needsModel: !hasTitle }
}

export function scopeFromToml(text: string): { workspace: string; project: string } | null {
  const found: Record<string, string> = {}
  for (const line of text.split('\n')) {
    if (/^\s*\[/.test(line)) break
    const m = line.match(/^\s*(workspace|project)\s*=\s*"([^"]*)"/)
    if (m) found[m[1]] = m[2]
  }
  return found.workspace && found.project ? { workspace: found.workspace, project: found.project } : null
}

const BRIEF_MARKER = 'ai-memory: project brief'
const HANDOFF_MARKER = 'ai-memory: pending handoff'

const RULE = /^## (.+?)\s*📌\s*\(`([^`]+)`\)$/

function rulesOf(lines: string[]): string[] {
  return lines.flatMap(line => {
    const m = line.match(RULE)
    return m ? [readableName({ id: m[2], path: m[2], title: m[1], snippet: '' }).name] : []
  })
}

export const isMemoryContext = (text: string) => text.includes(BRIEF_MARKER) || text.includes(HANDOFF_MARKER)

// Only entries carrying an ai-memory marker count; other hooks' context is ignored.
export function parseInjected(contexts: string[]): Injected | null {
  const mine = contexts.filter(isMemoryContext)
  if (!mine.length) return null
  const result: Injected = { rules: [] }
  for (const entry of mine) {
    const lines = entry.split('\n').map(l => l.trim())
    const handoffAt = lines.findIndex(l => l.includes(HANDOFF_MARKER))
    const items = handoffAt >= 0 ? lines.slice(handoffAt + 1).filter(l => l !== '' && !l.startsWith('>') && !l.startsWith('<!--') && !/^\*\*[^*]+\*\*:?$/.test(l)) : []
    const text = items.map(l => l.replace(/\*\*/g, '').replace(/^(#+|[-*]|\d+\.)\s+/, '')).find(l => !/^Tools used:/i.test(l))
    if (text) result.handoff = cleanLine(text)
    const briefAt = lines.findIndex(l => l.includes(BRIEF_MARKER))
    if (briefAt < 0) continue
    result.brief = true
    result.rules.push(...rulesOf(lines.slice(briefAt + 1)))
  }
  return result
}

export function mergeInjected(prev: Injected | null, next: Injected): Injected {
  return { ...prev, ...next, rules: [...new Set([...(prev?.rules ?? []), ...next.rules])] }
}
