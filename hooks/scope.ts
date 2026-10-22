import { scopeFromToml } from './memory'
import type { Scope } from '../types'

export async function resolveScope($: any, cwd: string): Promise<Scope | null> {
  for (let dir = cwd.replace(/\/+$/, ''); ; dir = dir.slice(0, dir.lastIndexOf('/'))) {
    const text = await $.fs.read(`${dir}/.ai-memory.toml`).catch(() => null)
    const scope = typeof text === 'string' ? scopeFromToml(text) : null
    if (scope) return scope
    if (dir === '') return null
  }
}
