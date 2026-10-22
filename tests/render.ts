// Draws a mounted pane's tree as text rows, one per child of the root column, the way a fixed-width cell grid would show it.
type Node = { type: string; props?: Record<string, any>; children?: (Node | string)[] }
type Seg = { text: string; style: string[] }

const cells = (s: string) => [...s].reduce((n, ch) => n + (/\p{Extended_Pictographic}/u.test(ch) ? 2 : 1), 0)

function styleOf(props: Record<string, any> = {}): string[] {
  return [props.color, props.dimColor && 'dim', props.bold && 'bold'].filter(Boolean)
}

function segs(node: Node | string, style: string[]): Seg[] {
  if (typeof node === 'string') return [{ text: node, style }]
  const own = node.type === 'Text' ? [...style, ...styleOf(node.props)] : style
  return (node.children ?? []).flatMap(child => segs(child, own))
}

function show(list: Seg[], styled: boolean): string {
  return list
    .map(s => {
      if (!styled || !s.style.length || !s.text.trim()) return s.text
      const [, lead, body, tail] = s.text.match(/^(\s*)(.*?)(\s*)$/) as RegExpMatchArray
      return `${lead}{${s.style.join(',')}}${body}{/}${tail}`
    })
    .join('')
}

function row(node: Node, columns: number, styled: boolean): string {
  if (node.type !== 'Box') return show(segs(node, []), styled)
  const parts = (node.children ?? []).map(child => (typeof child !== 'string' && child.type === 'Box' && child.props?.flexGrow ? null : segs(child, [])))
  const used = parts.reduce((n, p) => n + (p ? cells(p.map(s => s.text).join('')) : 0), 0)
  return parts.map(p => (p ? show(p, styled) : ' '.repeat(Math.max(0, columns - used)))).join('')
}

export function draw(tree: any, columns: number, styled = false): string[] {
  return (tree.children as Node[]).map(child => row(child, columns, styled).trimEnd())
}

export const widthOf = cells
