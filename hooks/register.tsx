import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Commit, Detail, DiffTab, FileChange, GraphData } from '../types'

const PANE = 'git-graph'
const DIFF_PREFIX = 'git-graph-diff-'
const TITLE = 'Git 그래프'
const MAX_COMMITS = 60
const REFRESH_MS = 30_000
const MAX_DIFF = 90_000
const MAX_SIDE_ROWS = 800
const SIDE_MIN_COLUMNS = 60

const data = atom(
  { plugin: 'git-graph', key: 'data' } as const,
  { raw: '', commits: [] } as GraphData,
  { shape: 'data-6' },
)
const detail = atom(
  { plugin: 'git-graph', key: 'detail' } as const,
  null as Detail | null,
  { shape: 'detail-4' },
)

const tabs = atom(
  { plugin: 'git-graph', key: 'tabs' } as const,
  {} as Record<string, DiffTab>,
  { shape: 'tabs-1' },
)

const SEP = '\x1f'
const LOG_ARGS = [
  'git', '-c', 'core.quotePath=false', '-c', 'i18n.logOutputEncoding=UTF-8', 'log', '--all', '--date-order',
  '--diff-merges=first-parent', '--no-renames', '--raw',
  `-n${MAX_COMMITS}`, '--date=format:%m-%d %H:%M',
  `--format=%x1e%H${SEP}%P${SEP}%D${SEP}%h${SEP}%an${SEP}%ad${SEP}%s${SEP}`,
]
const SHOW = ['git', '-c', 'core.quotePath=false', '-c', 'i18n.logOutputEncoding=UTF-8', 'show', '--first-parent', '-m', '--no-renames', '--format=']

/** 커밋 하나의 --raw 출력에서 변경 파일 목록을 뽑는다. */
export function parseChanges(rest: string): FileChange[] {
  const files: FileChange[] = []
  for (const line of rest.split('\n')) {
    const raw = /^:\S+ \S+ \S+ \S+ (\w)\S*\t(.+)$/.exec(line)
    if (raw) files.push({ path: raw[2] as string, status: raw[1] as string })
  }
  return files
}

export function parseLog(raw: string): Commit[] {
  return raw.split('\x1e').filter(record => record.trim()).map(record => {
    const [hash = '', parents = '', refs = '', short = '', author = '', date = '', subject = '', rest = ''] = record.split(SEP)
    return {
      hash,
      parents: parents.split(' ').filter(Boolean),
      refs: refs.split(', ').filter(Boolean).map(r => r.replace(/^HEAD -> /, '').replace(/^tag: /, '')),
      short,
      author,
      date,
      subject,
      files: parseChanges(rest),
    }
  })
}

/** git show 출력에서 앞머리를 빼고 hunk 만 남긴다. Code 는 탭·개행 말고 제어 문자를 받지 않고, 너무 길면 hunk 경계에서 자른다. */
export function hunksOf(raw: string): string {
  const clean = raw.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
  const start = clean.startsWith('@@') ? 0 : clean.indexOf('\n@@') + 1
  if (start === 0 && !clean.startsWith('@@')) return ''
  const body = clean.slice(start)
  if (body.length <= MAX_DIFF) return body
  const cut = body.lastIndexOf('\n@@', MAX_DIFF)
  return body.slice(0, cut > 0 ? cut : MAX_DIFF)
}

export type SideRow =
  | { kind: 'hunk'; text: string }
  | { kind: 'line'; oldNo?: number; newNo?: number; left?: string; right?: string; isChanged: boolean }

/** unified diff 를 좌우 비교 행으로 바꾼다. 연속된 삭제·추가는 같은 행끼리 짝을 맞춘다. */
export function sideBySide(hunks: string): SideRow[] {
  const rows: SideRow[] = []
  let oldNo = 0
  let newNo = 0
  let removed: string[] = []
  let added: string[] = []
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      const left = removed[i]
      const right = added[i]
      rows.push({
        kind: 'line',
        oldNo: left === undefined ? undefined : oldNo++,
        newNo: right === undefined ? undefined : newNo++,
        left,
        right,
        isChanged: true,
      })
    }
    removed = []
    added = []
  }
  for (const line of hunks.split('\n')) {
    const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line)
    if (head) {
      flush()
      oldNo = Number(head[1])
      newNo = Number(head[2])
      rows.push({ kind: 'hunk', text: line })
    } else if (line.startsWith('-')) removed.push(line.slice(1))
    else if (line.startsWith('+')) added.push(line.slice(1))
    else if (line.startsWith(' ')) {
      flush()
      const text = line.slice(1)
      rows.push({ kind: 'line', oldNo: oldNo++, newNo: newNo++, left: text, right: text, isChanged: false })
    }
  }
  flush()
  return rows
}

// VS Code Dark+ 의 diff·구문 색.
const DIFF_DEL_LINE = '#4b1818'
const DIFF_ADD_LINE = '#373d29'
const DIFF_DEL_WORD = '#8b2c2c'
const DIFF_ADD_WORD = '#5e7a2c'
const DIFF_EMPTY = '#252526'
const DIFF_LINE_NO = '#858585'
const SYNTAX = { text: '#d4d4d4', comment: '#6a9955', string: '#ce9178', number: '#b5cea8', keyword: '#569cd6', type: '#4ec9b0' }
const KEYWORDS = new Set(('using namespace class struct interface enum record public private protected internal static readonly const sealed abstract '
  + 'override virtual async await return if else for foreach while do switch case break continue new this base null true false var void int long '
  + 'float double decimal bool string object byte char get set try catch finally throw typeof in is as out ref function let import export from type').split(' '))

export type Span = { text: string; color: string; bg?: string }

/** 한 줄 구문 색. 여러 줄 주석·문자열은 줄 단위라 알 수 없어 일반 글자로 둔다. */
export function tokenize(text: string): Span[] {
  const spans: Span[] = []
  const add = (part: string, color: string) => {
    const last = spans[spans.length - 1]
    if (last && last.color === color) last.text += part
    else spans.push({ text: part, color })
  }
  const pattern = /(\/\/.*$)|("(?:[^"\\]|\\.)*"?)|(\b\d[\d.]*\b)|([A-Za-z_]\w*)|([\s\S])/g
  for (const [part, comment, str, num, word] of text.matchAll(pattern)) {
    if (comment) add(part, SYNTAX.comment)
    else if (str) add(part, SYNTAX.string)
    else if (num) add(part, SYNTAX.number)
    else if (word) add(part, KEYWORDS.has(word) ? SYNTAX.keyword : /^[A-Z]/.test(word) ? SYNTAX.type : SYNTAX.text)
    else add(part, SYNTAX.text)
  }
  return spans
}

/** 두 줄에서 앞뒤 공통 부분을 뺀, 실제로 바뀐 구간. */
export function changedRange(before: string, after: string) {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let tail = 0
  while (tail < before.length - start && tail < after.length - start
    && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++
  return { start, endOld: before.length - tail, endNew: after.length - tail }
}

/** 구문 색 위에 [start, end) 구간만 단어 강조 배경을 입힌다. */
export function paint(text: string, range: [number, number] | undefined, bg: string): Span[] {
  const spans = tokenize(text)
  if (!range || range[0] >= range[1]) return spans
  const [start, end] = range
  const out: Span[] = []
  let at = 0
  for (const span of spans) {
    const from = at
    const to = at + span.text.length
    at = to
    const cuts = [from, Math.min(to, Math.max(from, start)), Math.min(to, Math.max(from, end)), to]
    for (let i = 0; i < 3; i++) {
      const a = cuts[i] as number
      const b = cuts[i + 1] as number
      if (a < b) out.push({ text: text.slice(a, b), color: i === 1 ? '#ffffff' : span.color, ...(i === 1 ? { bg } : {}) })
    }
  }
  return out
}

type Row = { commit: Commit; lane: number; before: (string | null)[]; after: (string | null)[] }

/** 행마다 커밋 위·아래의 줄(lane) 상태를 계산한다. 각 줄에는 그 줄이 기다리는 커밋 해시가 들어 있다. */
export function layout(commits: Commit[]): Row[] {
  let lanes: (string | null)[] = []
  return commits.map(commit => {
    const before = lanes
    let lane = before.indexOf(commit.hash)
    const next = before.map(h => (h === commit.hash ? null : h))
    if (lane < 0) {
      lane = next.indexOf(null)
      if (lane < 0) lane = next.length
    }
    next[lane] = commit.parents[0] ?? null
    for (const parent of commit.parents.slice(1)) {
      if (next.includes(parent)) continue
      const free = next.indexOf(null)
      if (free < 0) next.push(parent)
      else next[free] = parent
    }
    while (next.length > 0 && next[next.length - 1] === null) next.pop()
    lanes = next
    return { commit, lane, before, after: next }
  })
}

const COLORS = ['#3b82f6', '#e8590c', '#16a34a', '#a855f7', '#db2777', '#0891b2', '#ca8a04']
const LANE_W = 14
const ROW_H = 24
const CELL_W = 7.5
const FONT_PX = 15
const ROW_SELECTED = '#04395e'
const ROW_HOVER = '#2a2d2e'
const FILE_STATUS: Record<string, string> = { A: 'success', D: 'error', M: 'warning' }
const MAX_LANES = 8

const laneWidth = (lanes: number) => Math.min(lanes, MAX_LANES) * LANE_W + 14

const textWidth = (s: string, size: number) =>
  [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e7f ? size * 0.88 : size * 0.52), 0)

export function fit(s: string, size: number, room: number): string {
  if (textWidth(s, size) <= room) return s
  let out = ''
  for (const c of s) {
    if (textWidth(out + c, size) > room - size) break
    out += c
  }
  return `${out}…`
}

const svgOf = (width: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${ROW_H}" viewBox="0 0 ${width} ${ROW_H}" preserveAspectRatio="xMinYMin meet"><style>path{fill:none;stroke-width:2}</style>${body}</svg>`

const laneX = (lane: number) => Math.min(lane, MAX_LANES - 1) * LANE_W + 10
const laneColor = (lane: number) => COLORS[lane % COLORS.length]

/** 커밋 한 줄의 그래프 선과 점. 줄 높이는 이 그림이 정한다(앱 글자 요소만으로는 20px 칸에 묶인다). */
export function rowSvg(row: Row, lanes: number): string {
  const edge = (from: number, y1: number, to: number, y2: number, c: string) => {
    const mid = (y1 + y2) / 2
    return `<path d="M${laneX(from)} ${y1}C${laneX(from)} ${mid} ${laneX(to)} ${mid} ${laneX(to)} ${y2}" stroke="${c}"/>`
  }
  const center = ROW_H / 2
  const lines: string[] = []
  row.before.forEach((hash, lane) => {
    if (hash === null) return
    if (hash === row.commit.hash) lines.push(edge(lane, 0, row.lane, center, laneColor(lane)))
    else lines.push(edge(lane, 0, row.after.indexOf(hash), ROW_H, laneColor(lane)))
  })
  for (const parent of row.commit.parents) {
    const lane = row.after.indexOf(parent)
    if (lane >= 0) lines.push(edge(row.lane, center, lane, ROW_H, laneColor(lane)))
  }
  return svgOf(laneWidth(lanes), `${lines.join('')}<circle cx="${laneX(row.lane)}" cy="${center}" r="4" fill="${laneColor(row.lane)}"/>`)
}

/** 호버 때 겹쳐 보이는 큰 점. 앱의 hover 표시 기능으로 켜지므로 호버에 앱을 오가지 않는다. */
export function dotSvg(row: Row, lanes: number): string {
  return svgOf(laneWidth(lanes), `<circle cx="${laneX(row.lane)}" cy="${ROW_H / 2}" r="6.5" fill="${laneColor(row.lane)}"/>`)
}

/** 펼친 커밋의 파일 줄에 그리는 직선 — 그래프 선이 끊기지 않게 한다. */
export function laneSvg(row: Row, lanes: number): string {
  const lines = row.after.flatMap((hash, lane) =>
    (hash === null ? [] : [`<path d="M${laneX(lane)} 0V${ROW_H}" stroke="${laneColor(lane)}"/>`]))
  return svgOf(laneWidth(lanes), lines.join(''))
}

// 그래프 선 계산과 그림은 커밋 내역이 바뀔 때만 다시 만든다.
let drawn: { raw: string; rows: Row[]; lanes: number; svgs: string[]; dotSvgs: string[]; lineSvgs: string[] } | undefined

function drawing(graph: GraphData) {
  if (drawn?.raw === graph.raw) return drawn
  const rows = layout(graph.commits)
  const lanes = Math.max(1, ...rows.map(r => Math.max(r.before.length, r.after.length, r.lane + 1)))
  drawn = { raw: graph.raw, rows, lanes, svgs: rows.map(r => rowSvg(r, lanes)), dotSvgs: rows.map(r => dotSvg(r, lanes)), lineSvgs: rows.map(r => laneSvg(r, lanes)) }
  return drawn
}

async function refresh($: EngineInterface) {
  let next: GraphData
  try {
    const { exitCode, stdout, stderr } = await $.process.run(LOG_ARGS)
    next = exitCode === 0
      ? { raw: stdout, commits: parseLog(stdout) }
      : { raw: stderr, commits: [], error: stderr.trim() || 'git log 실패' }
  } catch (err) {
    next = { raw: String(err), commits: [], error: String(err) }
  }
  if ((await read($, data)).raw !== next.raw) await update($, data, () => next)
}

async function selectCommit($: EngineInterface, hash: string) {
  const commit = (await read($, data)).commits.find(c => c.hash === hash)
  await update($, detail, old => (old?.hash === hash || !commit ? null : { hash, files: commit.files }))
}

/** 같은 커밋의 같은 파일은 같은 탭 하나로 — 탭 id 는 커밋 + 경로로 정한다(글자·숫자·-·_ 64자 이내). */
export function tabId(hash: string, path: string): string {
  let h = 5381
  for (const c of path) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0
  return `${DIFF_PREFIX}${hash.slice(0, 12)}-${h.toString(36)}`
}

async function selectFile($: EngineInterface, hash: string, path: string) {
  await update($, detail, old => (old?.hash === hash ? { ...old, path } : old))
  const id = tabId(hash, path)
  const isOpen = (await read($, tabs))[id] !== undefined
  if (!isOpen) await update($, tabs, old => ({ ...old, [id]: { hash, path } }))
  // 새 탭은 열리면서 앞으로 나오므로 그래프 탭을 다시 앞으로 — 목록을 보던 자리에서 계속 파일을 고를 수 있게.
  await $.ui.open({ id, title: `${path.split('/').pop() ?? path} (${hash.slice(0, 7)})` })
  await $.ui.open({ id: PANE, title: TITLE, focus: true })
  if (isOpen) return
  const { stdout } = await $.process.run([...SHOW, '-U3', hash, '--', path])
  const diff = hunksOf(stdout)
  await update($, tabs, old => (old[id] ? { ...old, [id]: { hash, path, diff } } : old))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'git-graph', description: 'Git 커밋 그래프 패널을 엽니다' })
    await refresh($)
    $.clock.every(REFRESH_MS, () => refresh($))
    // Git 저장소가 아닌 폴더의 세션에서는 패널을 띄우지 않는다(/git-graph 로는 열 수 있다).
    if (!(await read($, data)).error) void $.ui.open({ id: PANE, title: TITLE })
    await update($, detail, () => null)
    for (const id of Object.keys(await read($, tabs))) await $.ui.close({ id }).catch(() => undefined)
    await update($, tabs, () => ({}))
    return next(e)
  })

  on('command.run', { command: 'git-graph' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Git 그래프 패널을 열었습니다.' }
  })

  on('ui.message', async ($, e, next) => {
    const message = e.data as { select?: string; file?: string; hash?: string }
    if (typeof message.select === 'string') await selectCommit($, message.select)
    if (typeof message.file === 'string' && typeof message.hash === 'string') await selectFile($, message.hash, message.file)
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id.startsWith(DIFF_PREFIX)) {
      const closed = (await read($, tabs))[e.id]
      await update($, tabs, old => {
        const { [e.id]: _gone, ...rest } = old
        return rest
      })
      await update($, detail, old => (old && closed && old.hash === closed.hash && old.path === closed.path ? { ...old, path: undefined } : old))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (!e.requestId.startsWith(DIFF_PREFIX)) return next(e)
    const { Box, Text, Code } = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    const open = (await read($, tabs))[e.requestId]
    if (!open) return <Text dimColor>비교 내용을 찾을 수 없습니다. 커밋의 변경 파일을 다시 눌러 주세요.</Text>
    return (
      <Box flexDirection="column" rowGap={1}>
        <Text dimColor size="caption">{open.hash.slice(0, 7)} · {open.path}</Text>
        {open.diff === undefined && <Text dimColor>diff 를 읽는 중입니다.</Text>}
        {open.diff === '' && <Text dimColor>글자로 볼 수 있는 변경이 없습니다(바이너리 등).</Text>}
        {open.diff && columns < SIDE_MIN_COLUMNS && <Code source={open.diff} format="diff" path={open.path} />}
        {open.diff && columns >= SIDE_MIN_COLUMNS && (
          <Box flexDirection="column">
            {sideBySide(open.diff).slice(0, MAX_SIDE_ROWS).map(row => {
              if (row.kind === 'hunk') return <Text dimColor size="body" mono wrap="truncate-end">{row.text}</Text>
              const range = row.left !== undefined && row.right !== undefined && row.isChanged ? changedRange(row.left, row.right) : undefined
              const cell = (no: number | undefined, text: string | undefined, mark: string, lineBg: string, wordBg: string, span?: [number, number]) => (
                <Box width="50%" overflow="hidden" backgroundColor={!row.isChanged ? undefined : text === undefined ? DIFF_EMPTY : lineBg}>
                  <Text mono size="body" wrap="truncate-end">
                    <Text color={DIFF_LINE_NO}>{`${no ?? ''}`.padStart(5)} </Text>
                    <Text color={DIFF_LINE_NO}>{row.isChanged && text !== undefined ? mark : ' '} </Text>
                    {paint(text ?? '', span, wordBg).map(s => <Text color={s.color} backgroundColor={s.bg}>{s.text}</Text>)}
                  </Text>
                </Box>
              )
              return (
                <Box flexDirection="row">
                  {cell(row.oldNo, row.left, '-', DIFF_DEL_LINE, DIFF_DEL_WORD, range && [range.start, range.endOld])}
                  {cell(row.newNo, row.right, '+', DIFF_ADD_LINE, DIFF_ADD_WORD, range && [range.start, range.endNew])}
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const graph = await read($, data)
    const open = await read($, detail)
    const { Box, Text } = $.ui.resolve(e)
    if (graph.error) return <Text>{graph.error}</Text>
    if (graph.commits.length === 0) return <Text dimColor>커밋을 읽는 중입니다.</Text>
    if (e.surface === 'terminal') {
      return (
        <Box flexDirection="column">
          {graph.commits.map(c => <Text>{c.short} {c.subject}</Text>)}
        </Box>
      )
    }
    const { Svg, Client } = $.ui.resolve(e)
    const { rows, lanes, svgs, dotSvgs, lineSvgs } = drawing(graph)
    const room = e.props.bodyColumns * CELL_W - laneWidth(lanes) - 16
    const showRefs = room >= 420
    const showAuthor = room >= 500
    return (
      <Box flexDirection="column">
        {rows.map((row, index) => {
          const c = row.commit
          const isOpen = open?.hash === c.hash
          const meta = showAuthor ? `${c.author} · ${c.date}` : c.date
          const refs = showRefs && c.refs.length ? fit(c.refs.map(r => `[${r}]`).join(' '), 12, 140) : ''
          return (
            <Box flexDirection="column">
              <Box
                key={`row-${c.hash}`}
                flexDirection="row"
                alignItems="center"
                position="relative"
                backgroundColor={isOpen && !open?.path ? ROW_SELECTED : undefined}
                hover={isOpen && !open?.path ? undefined : { backgroundColor: ROW_HOVER }}
              >
                <Svg source={svgs[index] as string} alt="그래프 선" width={laneWidth(lanes)} height={ROW_H} />
                <Box position="absolute" top={0} left={0} right={0} bottom={0}>
                  <Client key={`hit-${c.hash}`} module="./hit.tsx" width="100%" height="100%" props={{ select: c.hash }} />
                </Box>
                <Box position="absolute" top={0} left={0} bottom={0} width={Math.ceil(laneWidth(lanes) / CELL_W)} display="none" hover={{ display: 'flex' }}>
                  <Svg source={dotSvgs[index] as string} alt="선택 점" width={laneWidth(lanes)} height={ROW_H} />
                </Box>
                <Box flexDirection="row" justifyContent="space-between" flexGrow={1} flexShrink={1} minWidth={0} columnGap={1}>
                  <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                    <Text weight="regular" size="heading" wrap="truncate-end">{c.subject}</Text>
                  </Box>
                  <Box flexDirection="row" columnGap={1} flexShrink={0}>
                    {refs !== '' && <Text size="caption" color="suggestion">{refs}</Text>}
                    <Text size="caption" dimColor>{meta}</Text>
                  </Box>
                </Box>
              </Box>
              {isOpen && open && open.files.map(file => {
                const slash = file.path.lastIndexOf('/')
                const name = file.path.slice(slash + 1)
                const dir = slash >= 0 ? file.path.slice(0, slash) : ''
                return (
                  <Box
                    key={`file-${c.hash}-${file.path}`}
                    flexDirection="row"
                    alignItems="center"
                    position="relative"
                    backgroundColor={open.path === file.path ? ROW_SELECTED : undefined}
                    hover={open.path === file.path ? undefined : { backgroundColor: ROW_HOVER }}
                  >
                    <Svg source={lineSvgs[index] as string} alt="그래프 선" width={laneWidth(lanes)} height={ROW_H} />
                    <Box position="absolute" top={0} left={0} right={0} bottom={0}>
                      <Client key={`hit-${c.hash}-${file.path}`} module="./hit.tsx" width="100%" height="100%" props={{ file: file.path, hash: c.hash }} />
                    </Box>
                    <Box flexDirection="row" justifyContent="space-between" flexGrow={1} flexShrink={1} minWidth={0} columnGap={1} paddingLeft={3}>
                      <Text>
                        <Text size="heading">{fit(name, FONT_PX, room - 60)}</Text>
                        <Text size="caption" dimColor>{`  ${fit(dir, 12, Math.max(40, room - textWidth(name, FONT_PX) - 70))}`}</Text>
                      </Text>
                      <Text size="caption" color={FILE_STATUS[file.status] ?? 'text'}>{file.status}</Text>
                    </Box>
                  </Box>
                )
              })}
            </Box>
          )
        })}
      </Box>
    )
  })
}
