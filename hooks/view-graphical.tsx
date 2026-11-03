import { ACCENT, START_ROWS, VERBS, clock, loadPane, onePerPage, plural, sessionCount } from './rows'
import type { Row } from './rows'
import { cleanLine } from './memory'

const TIME_CELLS = 5
const VERB_CELLS = 7

export async function drawGraphicalPane($: any, e: any) {
  const { Box, Text } = $.ui.resolve(e)
  const { scope, start, rows, where } = await loadPane($)

  const section = (title: string, count: string, lines: any[]) => (
    <Box flexDirection="column" gap="xs">
      <Box flexDirection="row" justifyContent="space-between" gap="sm">
        <Text size="caption" weight="semibold" color={ACCENT}>
          {title}
        </Text>
        <Text size="caption" dimColor>
          {count}
        </Text>
      </Box>
      {lines}
    </Box>
  )
  const plain = (text: string, dim = false) => <Text dimColor={dim}>{cleanLine(text, Infinity)}</Text>
  const cell = (cells: number, content?: any) => (
    <Box width={cells} flexShrink={0}>
      {content}
    </Box>
  )
  const activityRow = (row: Row) => {
    const tag = row.project && row.project !== scope?.project ? row.project : ''
    const name = cleanLine(row.name, Infinity)
    return (
      <Box flexDirection="row" gap="sm">
        {cell(
          TIME_CELLS,
          row.at !== undefined && (
            <Text size="footnote" mono tabular dimColor>
              {clock(row.at)}
            </Text>
          ),
        )}
        {cell(
          VERB_CELLS,
          !row.child && (
            <Text size="footnote" mono color={VERBS[row.verb]}>
              {row.verb}
            </Text>
          ),
        )}
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} paddingLeft={row.child ? 'sm' : 0}>
          <Text wrap="truncate-end">
            {tag ? <Text dimColor>[{tag}] </Text> : ''}
            {row.verb === 'query' && name ? `"${name}"` : name}
          </Text>
          {row.summary ? (
            <Text size="footnote" dimColor>
              {cleanLine(row.summary, Infinity)}
            </Text>
          ) : (
            ''
          )}
        </Box>
      </Box>
    )
  }

  const startLines = !start
    ? [plain('not available', true)]
    : !start.handoff && !start.rules.length
      ? [plain('nothing injected', true)]
      : [...(start.handoff ? [plain(`📥 ${start.handoff}`)] : []), ...start.rules.map(rule => plain(`📌 ${rule}`))].slice(0, START_ROWS)

  // The body scrolls, so nothing is fitted to a row count; the long session list goes last so it cannot push the other sections out of view.
  return (
    <Box flexDirection="column" gap="md">
      <Text size="caption" dimColor>
        {scope?.project ?? ''}
      </Text>
      {section('AT START', start?.brief ? plural(start.rules.length, 'rule') : '', startLines)}
      {section('LEFT OFF', '', [plain(where.text, where.dim)])}
      {section('THIS SESSION', sessionCount(rows).join(' · '), rows.length ? onePerPage(rows.map(row => ({ ...row }))).map(activityRow) : [plain('no memory calls yet', true)])}
    </Box>
  )
}
