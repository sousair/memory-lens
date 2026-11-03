import { atom, read } from 'claude-code'

import type { Activity, ActivityPage, Injected, LeftOff, Scope } from '../types'

const activity = atom({ plugin: 'memory-lens', key: 'activity' } as const, [] as Activity[])
const scopeAtom = atom({ plugin: 'memory-lens', key: 'scope' } as const, null as Scope | null)
const injected = atom({ plugin: 'memory-lens', key: 'injected' } as const, null as Injected | null)
const leftOffAtom = atom({ plugin: 'memory-lens', key: 'leftOff' } as const, null as LeftOff | null)

export const ACCENT = 'cyan'
export const VERBS = { query: 'yellow', read: 'blue', saved: 'green', removed: 'red', handoff: 'magenta' } as const
export type Verb = keyof typeof VERBS
export const START_ROWS = 3

export type Row = { verb: Verb; at?: number; name: string; project?: string; summary?: string; own?: boolean; key?: string; child?: boolean }

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

export function clock(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function rowsOf(entry: Activity, summaries: Record<string, string>): Row[] {
  const verb: Verb = entry.kind === 'read' ? 'read' : entry.kind === 'handoff' ? 'handoff' : entry.tool.endsWith('memory_delete_page') ? 'removed' : 'saved'
  const tool = entry.tool.replace(/^mcp__ai-memory__memory_/, '').replace(/^handoff_/, '').replace(/_/g, ' ')
  const pageRow = (page: ActivityPage): Row => {
    const summary = page.summary ?? summaries[page.summaryKey]
    return { verb, name: page.name, project: page.project, summary: summary !== page.name ? summary : undefined, own: page.summary !== undefined, key: page.key }
  }
  if (entry.tool.endsWith('memory_query')) {
    const seen = new Set<string>()
    const hits = (entry.pages ?? []).filter(page => !page.key || (!seen.has(page.key) && Boolean(seen.add(page.key))))
    return [{ verb: 'query', at: entry.at, name: entry.query ?? '' }, ...hits.map(page => ({ ...pageRow(page), child: true }))]
  }
  if (!entry.pages?.length) return [{ verb, at: entry.at, name: tool }]
  return entry.pages.map((page, i) => ({ ...pageRow(page), at: i === 0 ? entry.at : undefined }))
}

// Rows arrive newest first: a re-read page keeps its newest row, but borrows the page's own summary line from an older read when the newest has only a model one. Query hits stay under their query.
export function onePerPage(rows: Row[]): Row[] {
  const kept = new Map<string, Row>()
  return rows.filter(row => {
    if (!row.key || row.verb !== 'read' || row.child) return true
    const first = kept.get(row.key)
    if (!first) kept.set(row.key, row)
    else if (!first.own && row.own) Object.assign(first, { summary: row.summary, own: true })
    return !first
  })
}

export function sessionCount(rows: Row[]): string[] {
  const n = (verb: Verb) => rows.filter(r => r.verb === verb).length
  const [queries, reads, saved, removed, handoffs] = [n('query'), n('read'), n('saved'), n('removed'), n('handoff')]
  const parts = [queries && plural(queries, 'query', 'queries'), reads && plural(reads, 'read'), saved && `${saved} saved`, removed && `${removed} removed`, handoffs && plural(handoffs, 'handoff')]
  return parts.filter((p): p is string => Boolean(p))
}

// Rendering only reads: the host denies writes made while ui.render is dispatched, and a log there would repeat on every redraw.
export async function loadPane($: any) {
  const summaries = ((await $.store.get('summaries').catch(() => null)) ?? {}) as Record<string, string>
  const rows = (await read($, activity))
    .filter(entry => entry.kind !== 'other')
    .reverse()
    .flatMap(entry => rowsOf(entry, summaries))
  return {
    scope: await read($, scopeAtom),
    start: await read($, injected),
    rows,
    where: (await read($, leftOffAtom)) ?? { text: 'loading…', dim: true },
  }
}
