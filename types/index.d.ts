export type ToolKind = 'read' | 'write' | 'handoff' | 'other'

export type Injected = { handoff?: string; brief?: boolean; rules: string[] }

export type Viewport = { columns: number; isFullscreen?: boolean }

export type Scope = { workspace: string; project: string }

export type ActivityPage = { name: string; summaryKey: string; summary?: string; project?: string; key?: string }

export type LeftOff = { text: string; dim: boolean }

export type Activity = {
  at: number
  kind: ToolKind
  tool: string
  pages?: ActivityPage[]
  agentId?: string
  isError?: boolean
  toolUseId?: string
  query?: string
}

declare module 'claude-code' {
  interface PluginState {
    'memory-lens': {
      activity: Activity[]
      shown: string[]
      turnToasts: number
      scope: Scope | null
      injected: Injected | null
      opened: 'auto' | 'manual' | null
      closeAt: number
      viewport: Viewport | null
      lastSession: string | null
      leftOff: LeftOff | null
      summaryInFlight: string[]
      transcriptPath: string | null
      backfilled: boolean
    }
  }
}
