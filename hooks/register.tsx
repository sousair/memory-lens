import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Activity, Injected, Scope } from '../types'
import { MAX_ROWS, backfill, rememberTranscript } from './backfill'
import { classifyTool, hitsFor, isClaudeProjectFile, isMemoryContext, pageKey, parseInjected, mergeInjected, readableName, rowFor, summaryKey } from './memory'
import type { Hit } from './memory'
import type { Mode } from './pane'
import { refreshLeftOff } from './left-off'
import { PANE, autoOpen, forgetPane, registerPaneCommand, rememberViewport, togglePane } from './pane'
import { resolveScope } from './scope'
import { cachedSummary, requestSummary } from './summaries'
import { renderPane } from './view'

const activity = atom({ plugin: 'memory-lens', key: 'activity' } as const, [] as Activity[])
const shown = atom({ plugin: 'memory-lens', key: 'shown' } as const, [] as string[])
const turnToasts = atom({ plugin: 'memory-lens', key: 'turnToasts' } as const, 0)
const scopeAtom = atom({ plugin: 'memory-lens', key: 'scope' } as const, null as Scope | null)
const lastSession = atom({ plugin: 'memory-lens', key: 'lastSession' } as const, null as string | null)
const injected = atom({ plugin: 'memory-lens', key: 'injected' } as const, null as Injected | null)
const backfilled = atom({ plugin: 'memory-lens', key: 'backfilled' } as const, false)

function toastText(hit: Hit, scope: Scope | null, modelSummary?: string): string {
  const { name, summary = modelSummary } = readableName(hit)
  const prefix = hit.project && hit.project !== scope?.project ? `[${hit.project}] ` : ''
  return `🧠 ${prefix}${name}${summary && summary !== name ? ` — ${summary}` : ''}`
}

// Each step is one atomic update (the closure state is reset per attempt), so parallel calls cannot exceed the cap or toast a page twice.
async function claim($: any, keys: string[], cap: number): Promise<Set<string>> {
  let fresh: string[] = []
  await update($, shown, list => {
    fresh = [...new Set(keys)].filter(key => !list.includes(key))
    return [...list, ...fresh]
  })
  let granted = 0
  await update($, turnToasts, count => {
    granted = Math.max(0, Math.min(fresh.length, cap - count))
    return count + granted
  })
  const won = new Set(fresh.slice(0, granted))
  const lost = fresh.slice(granted)
  if (lost.length) await update($, shown, list => list.filter(key => !lost.includes(key)))
  return won
}

const SAVED_TO = /Full output saved to: (\S+)/

// Context over the inline limit arrives as a 2 KB preview naming the file that holds it all; only Claude's own project folders are followed.
async function fullText($: any, entry: string): Promise<string> {
  const path = isMemoryContext(entry) ? entry.match(SAVED_TO)?.[1] : undefined
  if (!path || !(await isClaudeProjectFile($, path))) return entry
  const text = await $.fs.read(path).catch(() => null)
  return typeof text === 'string' ? text : entry
}

async function recordInjected($: any, e: any, next: (e: any) => Promise<{ additionalContext?: string[] }>, mode: Mode, atStart: boolean) {
  const r = await next(e)
  try {
    const contexts = await Promise.all((r.additionalContext ?? []).map(entry => fullText($, entry)))
    const found = parseInjected(contexts) ?? { rules: [] }
    const before = JSON.stringify(await read($, injected))
    await update($, injected, prev => mergeInjected(prev, found))
    if (JSON.stringify(await read($, injected)) !== before) await refreshLeftOff($)
    if (atStart && found.handoff) await autoOpen($, mode)
  } catch (err) {
    $.ui.log(`memory-lens: ${err}`)
  }
  return r
}

export const register: Register = (on, options) => {
  const toastCap = Number(options?.toastCap ?? 12)
  const summariesOn = options?.summaries !== 'off'
  const mode = options?.mode === 'on' || options?.mode === 'off' ? options.mode : 'auto'
  const toastMs = Number(options?.toastSeconds ?? 6) * 1000

  on('session.start', async ($, e, next) => {
    try {
      await update($, shown, () => [])
      await update($, turnToasts, () => 0)
      await update($, scopeAtom, () => null)
      await update($, activity, () => [])
      await update($, backfilled, () => false)
      await forgetPane($)
      const scope = await resolveScope($, e.cwd)
      await update($, scopeAtom, () => scope)
      const previous = await $.store.get('lastSession').catch(() => null)
      await update($, lastSession, () => previous?.line ?? null)
      await refreshLeftOff($)
      await registerPaneCommand($, mode)
      if (previous?.line) {
        await $.store.delete('lastSession')
        await autoOpen($, mode)
      }
    } catch (err) {
      $.ui.log(`memory-lens: ${err}`)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    try {
      const rows = await read($, activity)
      const saved = rows.filter(row => row.kind === 'write' && !row.isError && row.tool.endsWith('memory_write_page')).length
      const handoffs = rows.filter(row => row.kind === 'handoff' && !row.isError && row.tool.endsWith('memory_handoff_begin')).length
      if (saved || handoffs) {
        const line = `Last session: saved ${saved} page${saved === 1 ? '' : 's'}${handoffs ? `, ${handoffs} handoff${handoffs === 1 ? '' : 's'}` : ''}`
        await $.store.set('lastSession', { line, at: Date.now() })
      }
    } catch (err) {
      $.ui.log(`memory-lens: ${err}`)
    }
    return next(e)
  })

  on('command.run', { command: 'memory-lens' }, ($, e) => togglePane($, e.presentation))
  on('command.run', { command: 'mem' }, ($, e) => togglePane($, e.presentation))

  on('session.attach', async ($, e, next) => {
    await rememberViewport($, e.viewport).catch(() => {})
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await forgetPane($).catch(() => {})
    return next(e)
  })

  on('ui.open', { id: PANE }, async ($, e, next) => {
    const r = await next(e)
    await backfill($)
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => renderPane($, e))

  on('prompt.submit', async ($, e, next) => {
    if (!e.agentId) await update($, turnToasts, () => 0).catch(() => {})
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    const r = await recordInjected($, e, next, mode, true)
    await rememberTranscript($, e.transcript_path)
    void backfill($)
    return r
  })
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const r = await recordInjected($, e, next, mode, false)
    await rememberTranscript($, e.transcript_path)
    void backfill($)
    return r
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    const kind = classifyTool(e.tool)
    if (!kind) return r
    try {
      const scope = await read($, scopeAtom)
      const isError = Boolean(r.isError || r.deny)
      const hits = hitsFor(e.tool, e, r.text ?? '', isError)
      const keys = hits.map(hit => pageKey(hit, scope))
      const won = new Set(await claim($, keys, toastCap))
      for (const [i, hit] of hits.entries()) {
        if (!won.delete(keys[i])) continue
        const lookup = readableName(hit).needsModel && summariesOn
        const cacheKey = summaryKey(keys[i], hit)
        const modelSummary = lookup ? await cachedSummary($, cacheKey) : undefined
        $.ui.toast(toastText(hit, scope, modelSummary), { timeoutMs: toastMs })
        if (lookup && !modelSummary) requestSummary($, hit, cacheKey, scope && { workspace: hit.workspace ?? scope.workspace, project: hit.project ?? scope.project }, summariesOn)
      }
      const entry = rowFor(e.tool, e, r.text ?? '', isError, scope, Date.now(), e.tool_use_id, e.agentId)
      await update($, activity, list => (entry.toolUseId && list.some(row => row.toolUseId === entry.toolUseId) ? list : [...list, entry].slice(-MAX_ROWS)))
      if ((kind === 'write' || kind === 'handoff') && !isError) {
        await refreshLeftOff($)
        await autoOpen($, mode)
      }
    } catch (err) {
      $.ui.log(`memory-lens: ${err}`)
    }
    return r
  })
}
