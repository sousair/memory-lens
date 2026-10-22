import { atom, read, update } from 'claude-code'

import type { Activity, Scope } from '../types'
import { parseTranscript } from './history'
import { isClaudeProjectFile, redraw, rowFor } from './memory'

const activity = atom({ plugin: 'memory-lens', key: 'activity' } as const, [] as Activity[])
const shown = atom({ plugin: 'memory-lens', key: 'shown' } as const, [] as string[])
const scopeAtom = atom({ plugin: 'memory-lens', key: 'scope' } as const, null as Scope | null)
const transcriptPath = atom({ plugin: 'memory-lens', key: 'transcriptPath' } as const, null as string | null)
const backfilled = atom({ plugin: 'memory-lens', key: 'backfilled' } as const, false)

export const MAX_ROWS = 200

export async function rememberTranscript($: any, path: unknown): Promise<void> {
  try {
    if (await isClaudeProjectFile($, path)) await update($, transcriptPath, () => path as string)
  } catch (err) {
    $.ui.log(`memory-lens: ${err}`)
  }
}

async function grep($: any, argv: string[], stdin?: string): Promise<string[]> {
  try {
    const { exitCode, stdout } = await $.process.run(argv, { timeoutMs: 5000, stdin })
    return exitCode === 0 ? stdout.split('\n') : []
  } catch {
    return []
  }
}

// Transcripts outgrow $.fs.read's 4 MiB limit, and every tool's result carries a tool_use_id, so the second pass asks only for the ai-memory calls' results.
async function transcriptLines($: any, path: string): Promise<string[]> {
  const calls = await grep($, ['grep', '-F', 'mcp__ai-memory__', path])
  const ids = parseTranscript(calls).map(call => `"tool_use_id":"${call.toolUseId}"`)
  if (!ids.length) return []
  return [...calls, ...(await grep($, ['grep', '-F', '-f', '-', path], ids.join('\n') + '\n'))]
}

// Backfilled pages join the toast claim set so a live re-read stays quiet, but never use up the turn's toast budget.
export async function backfill($: any): Promise<void> {
  try {
    const path = await read($, transcriptPath)
    if (!path) return
    let won = false
    await update($, backfilled, done => {
      won = !done
      return true
    })
    if (!won) return
    const lines = await transcriptLines($, path)
    if (!lines.length) return
    const scope = await read($, scopeAtom)
    const rows = parseTranscript(lines).map(call => rowFor(call.tool, call.input, call.resultText ?? '', call.isError, scope, call.at, call.toolUseId))
    const keys = rows.flatMap(row => row.pages?.flatMap(page => (page.key ? [page.key] : [])) ?? [])
    await update($, shown, list => [...new Set([...list, ...keys])])
    await update($, activity, list => {
      const seen = new Set(list.map(row => row.toolUseId))
      return [...list, ...rows.filter(row => !seen.has(row.toolUseId))].sort((a, b) => a.at - b.at).slice(-MAX_ROWS)
    })
    redraw($)
  } catch (err) {
    $.ui.log(`memory-lens: ${err}`)
  }
}
