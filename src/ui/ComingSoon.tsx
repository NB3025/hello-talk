import type { RoadmapItem } from '../domain/roadmap';

/**
 * 아직 열리지 않은 항목. **자리는 잡되 눌리지 않는다.**
 *
 * 빈칸으로 두지 않는 이유는 그리드의 밀도 자체가 정보 계층의 일부이기 때문이다 —
 * 실제 카카오톡 더보기도 아이콘이 촘촘히 차 있고, 그 촘촘함이 "여기가 모든 것의
 * 입구"라는 뜻이다. 항목을 지우면 그 뜻이 사라진다.
 *
 * 배지를 아이콘 위에 겹치지 않고 **라벨 아래 줄**로 두는 이유: 그리드 칸이 좁아
 * `오픈 예정` 네 글자가 글리프를 덮어 무슨 아이콘인지 알 수 없게 된다(실제로 겹쳐
 * 봤고 캘린더 아이콘이 잘렸다). 세로로 한 줄 더 쓰는 편이 읽힌다.
 */
export function ComingSoon({ item }: { item: RoadmapItem }) {
  return (
    <button disabled title={item.note} aria-label={`${item.label} — 오픈 예정`}>
      <span className="ic" aria-hidden="true">
        {item.glyph}
      </span>
      {item.label}
      <span className="soon" aria-hidden="true">
        오픈 예정
      </span>
    </button>
  );
}

/** 알약 버튼 자리에 쓰는 형태. 친구 시트처럼 그리드가 아닌 곳에서 쓴다. */
export function ComingSoonPill({ item }: { item: RoadmapItem }) {
  return (
    <button className="pill" disabled title={item.note}>
      {item.glyph} {item.label}
      <span className="soon inline" aria-hidden="true">
        오픈 예정
      </span>
    </button>
  );
}
