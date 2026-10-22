import { atom, read, update } from 'claude-code'

import type { LeftOff, Scope } from '../types'
import { parseHits, readableName, redraw } from './memory'

const scopeAtom = atom({ plugin: 'memory-lens', key: 'scope' } as const, null as Scope | null)
const lastSession = atom({ plugin: 'memory-lens', key: 'lastSession' } as const, null as string | null)
const leftOffAtom = atom({ plugin: 'memory-lens', key: 'leftOff' } as const, null as LeftOff | null)

async function compute($: any): Promise<LeftOff> {
  const last = await read($, lastSession)
  if (last) return { text: last, dim: false }
  const scope = await read($, scopeAtom)
  if (!scope) return { text: 'unavailable', dim: true }
  try {
    const result = await $.mcp.call('ai-memory', 'memory_recent', { ...scope, limit: 5 })
    if (result.isError) return { text: 'unavailable', dim: true }
    const text = result.content?.find((block: any) => block.type === 'text')?.text ?? ''
    const hit = parseHits(text)[0]
    return hit ? { text: readableName(hit).name, dim: false } : { text: 'nothing carried over', dim: true }
  } catch {
    return { text: 'unavailable', dim: true }
  }
}

// The host denies state writes and MCP calls while ui.render is dispatched, so left off is fetched here and the pane only reads it.
export async function refreshLeftOff($: any): Promise<void> {
  try {
    const where = await compute($)
    await update($, leftOffAtom, () => where)
    redraw($)
  } catch (err) {
    $.ui.log(`memory-lens: ${err}`)
  }
}
