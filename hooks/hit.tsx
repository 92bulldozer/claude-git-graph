import type { ClientModule } from 'claude-code'

type HitProps = { select?: string; file?: string; hash?: string }

/** 줄 위에 겹치는 투명한 클릭 영역. 앱 버튼은 호버 때 글자만 하얗게 반전돼 쓰지 않는다. 호버는 앱의 hover 가 처리하고, 여기서는 누름만 보낸다. */
const RowHit: ClientModule<HitProps> = (props, surface) => {
  surface.onPointer(e => {
    if (e.type === 'down' && e.button === 'left') surface.post(props)
  })
  return surface.elements.Box({ width: '100%', height: '100%' })
}

export default RowHit
