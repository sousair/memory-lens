import { atom, read, update } from 'claude-code'

import type { Viewport } from '../types'
import { refreshLeftOff } from './left-off'

export const PANE = 'memory-lens'
const IDLE_MS = 25_000
const MIN_COLUMNS = 144

export type Mode = 'on' | 'off' | 'auto'
const opened = atom({ plugin: 'memory-lens', key: 'opened' } as const, null as 'auto' | 'manual' | null)
const closeAt = atom({ plugin: 'memory-lens', key: 'closeAt' } as const, 0)
const viewportAtom = atom({ plugin: 'memory-lens', key: 'viewport' } as const, null as Viewport | null)

export async function forgetPane($: any): Promise<void> {
  await update($, opened, () => null)
}

export async function rememberViewport($: any, viewport?: Viewport): Promise<void> {
  if (!viewport) return
  const { columns, isFullscreen } = viewport
  await update($, viewportAtom, () => ({ columns, isFullscreen }))
}

// Skip only where the viewport is known not to dock a pane or to be narrow; unknown leaves the engine's own 144-column rule.
export async function autoOpen($: any, mode: Mode): Promise<void> {
  const state = await read($, opened)
  if (mode !== 'auto' || state === 'manual') return
  if (!state) {
    const viewport = await read($, viewportAtom)
    if (viewport && (viewport.isFullscreen === false || viewport.columns < MIN_COLUMNS)) return
    await $.ui.open({ id: PANE, title: PANE })
    await update($, opened, () => 'auto' as const)
  }
  // Later activity pushes the deadline out; an earlier timer sees it and does nothing.
  const deadline = (await $.clock.now()) + IDLE_MS
  await update($, closeAt, () => deadline)
  $.clock.after(IDLE_MS, async () => {
    try {
      if ((await read($, closeAt)) > (await $.clock.now()) || (await read($, opened)) !== 'auto') return
      await update($, opened, () => null)
      await $.ui.close({ id: PANE })
    } catch (err) {
      $.ui.log(`memory-lens: ${err}`)
    }
  })
}

export async function registerPaneCommand($: any, mode: Mode): Promise<void> {
  await $.command.register({ name: 'memory-lens', description: 'Toggle the memory-lens pane' })
  await $.command.register({ name: 'mem', description: 'Toggle the memory-lens pane (short for /memory-lens)' })
  if (mode !== 'on') return
  try {
    await $.ui.open({ id: PANE, title: PANE })
    await update($, opened, () => 'manual' as const)
  } catch (err) {
    $.ui.log(`memory-lens: ${err}`)
  }
}

export async function togglePane($: any, presentation?: Viewport): Promise<{ text: string }> {
  try {
    await rememberViewport($, presentation)
    const state = await read($, opened)
    if (state === 'auto') {
      await update($, opened, () => 'manual' as const)
      return { text: 'memory-lens pane pinned open.' }
    }
    if (state) {
      await update($, opened, () => null)
      await $.ui.close({ id: PANE })
      return { text: 'memory-lens pane closed.' }
    }
    await refreshLeftOff($)
    await $.ui.open({ id: PANE, title: PANE })
    await update($, opened, () => 'manual' as const)
    return { text: 'memory-lens pane opened.' }
  } catch (err) {
    $.ui.log(`memory-lens: ${err}`)
    return { text: 'memory-lens pane unavailable.' }
  }
}
