export type PastCall = {
  toolUseId: string
  at: number
  tool: string
  input: Record<string, unknown>
  resultText?: string
  isError: boolean
  isSidechain: boolean
}

const PREFIX = 'mcp__ai-memory__'

function record(line: string): any {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => (part?.type === 'text' && typeof part.text === 'string' ? part.text : '')).join('')
}

export function parseTranscript(lines: string[]): PastCall[] {
  const calls = new Map<string, PastCall>()
  for (const line of lines) {
    const rec = record(line)
    const blocks = rec?.message?.content
    if (!Array.isArray(blocks)) continue
    const at = Date.parse(rec.timestamp)
    for (const block of blocks) {
      if (rec.type === 'assistant' && block?.type === 'tool_use' && typeof block.name === 'string' && block.name.startsWith(PREFIX) && typeof block.id === 'string' && !Number.isNaN(at)) {
        calls.set(block.id, {
          toolUseId: block.id,
          at,
          tool: block.name,
          input: block.input && typeof block.input === 'object' ? block.input : {},
          isError: false,
          isSidechain: rec.isSidechain === true,
        })
      } else if (rec.type === 'user' && block?.type === 'tool_result') {
        const call = calls.get(block.tool_use_id)
        if (!call) continue
        call.resultText = textOf(block.content)
        call.isError = block.is_error === true
      }
    }
  }
  return [...calls.values()].sort((a, b) => a.at - b.at)
}
