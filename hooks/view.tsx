import { ACCENT, VERBS, START_ROWS, clock, loadPane, onePerPage, plural, sessionCount } from './rows'
import type { Row } from './rows'
import { drawGraphicalPane } from './view-graphical'
import { cleanLine } from './memory'

const VERB_WIDTH = 8
// ' HH:MM ' plus the padded verb; summaries indent to here so they sit under the name.
const NAME_AT = 7 + VERB_WIDTH
const CHILD_AT = NAME_AT + 2

type Section = { title: string; count: string[]; lines: any[] }

function wrap(text: string, width: number, max: number): string[] {
  const out: string[] = []
  let words = cleanLine(text, Infinity).split(' ')
  while (words.length && out.length < max) {
    const last = out.length === max - 1
    let take = 1
    while (take < words.length && words.slice(0, take + 1).join(' ').length <= width) take++
    if (last && take < words.length) {
      while (take > 1 && words.slice(0, take).join(' ').length > width - 1) take--
      out.push(cleanLine(words.slice(0, take).join(' ') + '…', width))
      break
    }
    out.push(cleanLine(words.slice(0, take).join(' '), width))
    words = words.slice(take)
  }
  return out
}

// Whole parts are dropped from the end so a narrow pane never shows half a count.
function countText(parts: string[], max: number): string {
  let kept = parts
  while (kept.length > 1 && kept.join(' · ').length > max) kept = kept.slice(0, -1)
  return cleanLine(kept.length < parts.length ? `${kept.join(' · ')} …` : kept.join(' · '), max)
}

// Each section keeps header plus one row; spare rows then go to sections in priority order, each taking all it has, and blank separators only take what is left.
function fit(sections: Section[], priority: Section[], room: number): { shown: Section[]; gaps: boolean } {
  const take = new Map<Section, number>()
  for (const s of priority) {
    if (!s.lines.length || room < 2) continue
    take.set(s, 1)
    room -= 2
  }
  for (const [s, n] of take) {
    const extra = Math.min(s.lines.length - n, room)
    take.set(s, n + extra)
    room -= extra
  }
  const gaps = take.size > 1 && room >= take.size - 1
  return { shown: sections.filter(s => take.has(s)).map(s => ({ ...s, lines: s.lines.slice(0, take.get(s)) })), gaps }
}

export async function renderPane($: any, e: any) {
  const { Text } = $.ui.resolve(e)
  try {
    // Only the terminal is a cell grid; other surfaces set text in a proportional face and scroll the body themselves.
    return await (e.surface === 'terminal' ? drawPane($, e) : drawGraphicalPane($, e))
  } catch {
    return <Text dimColor>memory-lens: unavailable</Text>
  }
}

async function drawPane($: any, e: any) {
  const { Box, Text } = $.ui.resolve(e)
  const width = Math.min(80, e.props?.bodyColumns || 80)
  const height = e.props?.scroll?.bodyRows ?? 24
  const { scope, start, rows, where } = await loadPane($)

  const spread = (left: string, right: string, style: object) => (
    <Box flexDirection="row" height={1}>
      <Text {...style}>{left}</Text>
      <Box flexGrow={1} />
      <Text dimColor wrap="truncate-end">
        {right}
      </Text>
    </Box>
  )
  const plain = (text: string, dim = false) => (
    <Text dimColor={dim} wrap="truncate-end">
      {` ${cleanLine(text, width - 1)}`}
    </Text>
  )
  const activityRow = (row: Row) => {
    const tag = row.project && row.project !== scope?.project ? `[${row.project}] ` : ''
    if (row.child)
      return (
        <Text wrap="truncate-end">
          {' '.repeat(CHILD_AT)}
          {tag ? <Text dimColor>{tag.trimEnd()}</Text> : ''}
          {tag ? ' ' : ''}
          {cleanLine(row.name, width - CHILD_AT - tag.length)}
        </Text>
      )
    const name = row.verb === 'query' ? (row.name ? `"${cleanLine(row.name, width - NAME_AT - 2)}"` : '') : cleanLine(row.name, width - NAME_AT - tag.length)
    return (
      <Text wrap="truncate-end">
        {' '}
        <Text dimColor>{row.at === undefined ? '     ' : clock(row.at)}</Text>{' '}
        <Text color={VERBS[row.verb]}>{row.verb}</Text>
        {' '.repeat(VERB_WIDTH - row.verb.length)}
        {tag ? <Text dimColor>{tag.trimEnd()}</Text> : ''}
        {tag ? ' ' : ''}
        {name}
      </Text>
    )
  }
  const summaryRow = (indent: number) => (line: string) => (
    <Text wrap="truncate-end">
      {' '.repeat(indent)}
      <Text dimColor>{line}</Text>
    </Text>
  )

  const atStart: Section = {
    title: 'AT START',
    count: start?.brief ? [plural(start.rules.length, 'rule')] : [],
    lines: !start
      ? [plain('not available', true)]
      : !start.handoff && !start.rules.length
        ? [plain('nothing injected', true)]
        : [...(start.handoff ? [plain(`📥 ${start.handoff}`)] : []), ...start.rules.map(rule => plain(`📌 ${rule}`))].slice(0, START_ROWS),
  }
  const session: Section = {
    title: 'THIS SESSION',
    count: sessionCount(rows),
    lines: rows.length
      ? onePerPage(rows.map(row => ({ ...row }))).flatMap(row => [activityRow(row), ...(row.summary ? wrap(row.summary, width - (row.child ? CHILD_AT : NAME_AT), 2).map(summaryRow(row.child ? CHILD_AT : NAME_AT)) : [])])
      : [plain('no memory calls yet', true)],
  }
  const left: Section = { title: 'LEFT OFF', count: [], lines: [plain(where.text, where.dim)] }
  const { shown, gaps } = fit([atStart, session, left], [session, atStart, left], Math.max(0, height - 2))

  const title = '🧠 memory-lens'
  return (
    <Box flexDirection="column">
      {spread(title, cleanLine(scope?.project ?? '', width - title.length - 1), { bold: true })}
      <Text dimColor>{'─'.repeat(width)}</Text>
      {shown.flatMap((s, i) => [
        ...(gaps && i > 0 ? [<Text> </Text>] : []),
        spread(s.title, countText(s.count, width - s.title.length - 1), { bold: true, color: ACCENT }),
        ...s.lines,
      ])}
    </Box>
  )
}
