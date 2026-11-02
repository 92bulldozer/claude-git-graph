import { expect, test } from 'claude-code/testing'

import { tabId, changedRange, dotSvg, fit, hunksOf, laneSvg, layout, paint, parseChanges, parseLog, rowSvg, sideBySide, tokenize } from './register'

test('탭 id 는 같은 파일이면 같고 앱 규칙(64자, 글자·숫자·-)에 맞는다', () => {
  const hash = 'a'.repeat(40)
  const id = tabId(hash, 'Views/한글 파일.cs')
  expect(id).toBe(tabId(hash, 'Views/한글 파일.cs'))
  expect(id).not.toBe(tabId(hash, 'Views/다른.cs'))
  expect(id).not.toBe(tabId('b'.repeat(40), 'Views/한글 파일.cs'))
  expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
})

test('구문 색은 문자열·주석·키워드를 나눈다', () => {
  const spans = tokenize('public int a = "x"; // 끝')
  expect(spans.map(s => s.text).join('')).toBe('public int a = "x"; // 끝')
  expect(spans.find(s => s.text === '"x"')?.color).toBe('#ce9178')
  expect(spans.find(s => s.text.startsWith('//'))?.color).toBe('#6a9955')
  expect(spans[0]?.color).toBe('#569cd6')
})

test('단어 강조는 실제로 바뀐 구간만 칠한다', () => {
  const range = changedRange('"elapsed": 159,', '"elapsed": 181,')
  expect(range).toEqual({ start: 12, endOld: 14, endNew: 14 })
  const spans = paint('"elapsed": 159,', [range.start, range.endOld], '#f00')
  expect(spans.map(s => s.text).join('')).toBe('"elapsed": 159,')
  expect(spans.filter(s => s.bg).map(s => s.text).join('')).toBe('59')
})

const S = '\x1f'
const line = (hash: string, parents: string, refs = '') =>
  '\x1e' + [hash, parents, refs, hash, '작성자', '10-30 11:52', `커밋 ${hash}`, `본문 ${hash}\n\nCo-Authored-By: 누구\n\n:100644 100644 aaa bbb M\ta b.cs\n3\t1\ta b.cs\n`].join(S)

const merge = parseLog([
  line('d', 'b c', 'HEAD -> main, origin/main, tag: v1'),
  line('c', 'a'),
  line('b', 'a'),
  line('a', ''),
].join(''))

test('참조와 부모 커밋을 읽는다', () => {
  expect(merge[0]?.parents).toEqual(['b', 'c'])
  expect(merge[0]?.refs).toEqual(['main', 'origin/main', 'v1'])
})

test('갈라진 브랜치는 자기 줄을 갖고 다시 합쳐진다', () => {
  const rows = layout(merge)
  expect(rows.map(r => r.lane)).toEqual([0, 1, 0, 0])
  expect(rows[0]?.after).toEqual(['b', 'c'])
  expect(rows[3]?.after).toEqual([])
})

test('행 그림은 점과 부모로 가는 선을 그리고 파일 줄은 직선만 잇는다', () => {
  const rows = layout(merge)
  expect(rowSvg(rows[0]!, 2).match(/<path/g)?.length).toBe(2)
  expect(rowSvg(rows[0]!, 2)).toContain('<circle')
  expect(laneSvg(rows[0]!, 2).match(/<path/g)?.length).toBe(2)
  expect(laneSvg(rows[0]!, 2)).not.toContain('<circle')
  expect(dotSvg(rows[0]!, 2)).toContain('r="6.5"')
})

test('파일 목록은 --raw 줄에서 읽고 긴 글자는 잘린다', () => {
  expect(merge[0]?.files).toEqual([{ path: 'a b.cs', status: 'M' }])
  expect(fit('가나다라마바사아자차', 14, 60).endsWith('…')).toBe(true)
  expect(fit('abc', 14, 60)).toBe('abc')
})

test('diff 는 hunk 만 남기고 CR 을 지운다', () => {
  const raw = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\r\n-x\r\n+y\r\n'
  expect(hunksOf(raw)).toBe('@@ -1 +1 @@\n-x\n+y\n')
  expect(hunksOf('Binary files differ\n')).toBe('')
})

test('긴 diff 는 hunk 경계에서 자른다', () => {
  const hunk = `@@ -1 +1 @@\n+${'x'.repeat(60_000)}\n`
  const out = hunksOf(hunk + hunk)
  expect(out).toBe(hunk.slice(0, -1))
})

test('좌우 비교는 삭제와 추가를 같은 행에 맞추고 줄 번호를 이어 간다', () => {
  const rows = sideBySide('@@ -10,3 +10,4 @@ 함수\n 같음\n-옛줄\n+새줄\n+추가\n 끝\n')
  expect(rows.slice(1)).toEqual([
    { kind: 'line', oldNo: 10, newNo: 10, left: '같음', right: '같음', isChanged: false },
    { kind: 'line', oldNo: 11, newNo: 11, left: '옛줄', right: '새줄', isChanged: true },
    { kind: 'line', oldNo: undefined, newNo: 12, left: undefined, right: '추가', isChanged: true },
    { kind: 'line', oldNo: 12, newNo: 13, left: '끝', right: '끝', isChanged: false },
  ])
})
