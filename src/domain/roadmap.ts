/**
 * 앞으로 붙일 서비스 목록. **화면이 이 파일을 읽는다.**
 *
 * 목록을 문서에만 적어두면 화면의 `오픈 예정` 배지와 반드시 어긋난다 —
 * 선물 규칙을 `checkGiftAction` 한 곳에 두고 버튼 비활성화에도 같은 함수를 쓰는 것과
 * 같은 이유다. 규칙이 두 곳에 적히면 한 곳은 낡는다.
 *
 * 근거와 출처는 `docs/ROADMAP.md` 에 있다. 이 파일은 화면이 필요한 최소한만 들고 있다.
 */

export type RoadmapStatus =
  /** 이미 동작한다. */
  | 'shipped'
  /** 화면에 자리를 잡고 `오픈 예정` 으로 표시한다. */
  | 'soon'
  /** 이 구조(서버 없음)로는 무리다. 화면에 자리를 만들지 않는다. */
  | 'out';

/**
 * 카카오톡이 외부 서비스를 대화에 끌어들이는 방식은 세 가지로 수렴한다.
 * 무엇을 만들지보다 **어떻게 붙일지**가 여기서 결정된다.
 */
export type CouplingPattern =
  /** A: 대화에 카드를 흘린다. 카드는 상태를 굳히지 않고 원본에서 매번 읽는다. */
  | 'card-in-chat'
  /** B: 친구 그래프만 빌려간다. 화면은 밖에 있고 관계망만 가져온다. */
  | 'borrow-graph'
  /** C: 별도 공유 컨테이너를 만들고 친구를 초대한다. 대화가 아닌 제3의 객체. */
  | 'shared-container';

export interface RoadmapItem {
  id: string;
  /** 화면에 뜨는 이름. */
  label: string;
  glyph: string;
  status: RoadmapStatus;
  /** 배지를 누르거나 호버할 때 보이는 한 줄. 왜 아직 없는지가 아니라 무엇인지를 적는다. */
  note: string;
  pattern?: CouplingPattern;
  /** 이 항목이 놓일 자리. 더보기 그리드에 넣을지 판단에 쓴다. */
  surface: 'more' | 'friend' | 'gift' | 'chat';
}

export const ROADMAP: readonly RoadmapItem[] = [
  // ── 이미 동작하는 것 ────────────────────────────────────────────────
  {
    id: 'gift',
    label: '선물하기',
    glyph: '🎁',
    status: 'shipped',
    note: '구매자와 수령자가 다른 커머스. 대화방에 선물 카드가 남는다.',
    pattern: 'card-in-chat',
    surface: 'more',
  },
  {
    id: 'giftbox',
    label: '선물함',
    glyph: '🎟',
    status: 'shipped',
    note: '받은 선물과 교환권. 만료는 저장하지 않고 계산한다.',
    surface: 'more',
  },

  // ── 다음 슬라이스 후보: 지금 구조에 그대로 얹힌다 ──────────────────
  {
    id: 'calendar',
    label: '캘린더',
    glyph: '📅',
    status: 'soon',
    note: '일정과 할 일. 톡캘린더는 REST API 로 스키마가 공개돼 있어 추측이 필요 없다.',
    pattern: 'card-in-chat',
    surface: 'more',
  },
  {
    id: 'schedule-from-friend',
    label: '일정 만들기',
    glyph: '🗓',
    status: 'soon',
    note: '사람에서 일정을 시작한다. 카카오톡도 채팅방에서 일정을 만드는 것이 서비스 정의다.',
    pattern: 'card-in-chat',
    surface: 'friend',
  },
  {
    id: 'wish',
    label: '위시리스트',
    glyph: '💛',
    status: 'soon',
    note: '받고 싶은 것을 담아두고 친구에게 공개한다. 비어 있으면 담아 달라고 메시지를 보낸다.',
    pattern: 'card-in-chat',
    surface: 'gift',
  },
  {
    id: 'pung',
    label: '펑',
    glyph: '💥',
    status: 'soon',
    note: '24시간 뒤 사라지는 게시물. 사라짐을 저장하지 않고 계산한다 — 안읽음과 같은 원리.',
    surface: 'more',
  },
  {
    id: 'teamchat',
    label: '팀채팅',
    glyph: '📋',
    status: 'soon',
    note: '공지와 투표가 중심인 방. 흐르는 대화로는 합의가 되지 않기 때문에 따로 있다.',
    pattern: 'shared-container',
    surface: 'chat',
  },
  {
    id: 'groupchat',
    label: '그룹 채팅방 만들기',
    glyph: '👥',
    status: 'soon',
    note: '자료 구조는 이미 여러 명을 담는다. 방을 만드는 경로만 없다.',
    surface: 'chat',
  },
  {
    id: 'emoticon',
    label: '이모티콘',
    glyph: '😀',
    status: 'soon',
    note: '구독권을 친구에게 선물할 수 있다 — 실물·교환권에 이어 세 번째 상품 종류.',
    pattern: 'card-in-chat',
    surface: 'more',
  },

  // ── 구조를 늘려야 하는 것 ───────────────────────────────────────────
  {
    id: 'giftgame',
    label: '선물게임',
    glyph: '🎲',
    status: 'soon',
    note: '받는 사람을 미리 정하지 않고 방 안에서 정한다. 주문에 수신자 미정 단계가 생긴다.',
    pattern: 'card-in-chat',
    surface: 'gift',
  },
  {
    id: 'giftcode',
    label: '코드선물',
    glyph: '🔢',
    status: 'soon',
    note: '수신자를 지정하지 않고 코드를 흘린다. 먼저 등록한 사람이 가져간다.',
    pattern: 'card-in-chat',
    surface: 'gift',
  },
  {
    id: 'settle',
    label: '정산하기',
    glyph: '🧮',
    status: 'soon',
    note: '함께 쓴 돈을 나눈다. 대화 메시지가 아니라 멤버를 초대한 공유 장부로 만든다.',
    pattern: 'shared-container',
    surface: 'more',
  },
  {
    id: 'transfer',
    label: '송금',
    glyph: '💸',
    status: 'soon',
    note: '계좌번호 없이 친구 관계만으로 보낸다. 화면은 밖에 있고 관계망만 빌려간다.',
    pattern: 'borrow-graph',
    surface: 'more',
  },
  {
    id: 'shopping',
    label: '쇼핑하기',
    glyph: '🛍',
    status: 'soon',
    note: '선물하기와 다른 장사다 — 사는 사람과 받는 사람이 같다.',
    surface: 'more',
  },

  // ── 이 구조로는 무리: 화면에 자리를 만들지 않는다 ────────────────────
  {
    id: 'voicetalk',
    label: '보이스톡',
    glyph: '📞',
    status: 'out',
    note: 'WebRTC 와 시그널링 서버가 필요하다. 서버가 없는 이 구조로는 흉내만 낼 수 있다.',
    surface: 'chat',
  },
  {
    id: 'talkcloud',
    label: '톡클라우드',
    glyph: '☁',
    status: 'out',
    note: '백업할 원격 저장소가 없다. localStorage 가 이미 유일한 사본이다.',
    surface: 'more',
  },
  {
    id: 'map',
    label: '지도·친구위치',
    glyph: '📍',
    status: 'out',
    note: '외부 지도 SDK 키가 필요하다. "어디야?"라는 대화를 지도로 대체하는 설계가 원형이다.',
    pattern: 'shared-container',
    surface: 'chat',
  },
  {
    id: 'aisummary',
    label: 'AI 대화 요약',
    glyph: '✨',
    status: 'out',
    note: '모델 호출에 서버와 키가 필요하다.',
    surface: 'chat',
  },
];

/** 특정 화면에 자리를 잡을 항목. `out` 은 자리를 만들지 않으므로 제외된다. */
export function roadmapFor(surface: RoadmapItem['surface']): RoadmapItem[] {
  return ROADMAP.filter((i) => i.surface === surface && i.status !== 'out');
}

/** 아직 열리지 않은 항목 수. 안내 문구에 쓴다. */
export function comingSoonCount(): number {
  return ROADMAP.filter((i) => i.status === 'soon').length;
}

export function roadmapItem(id: string): RoadmapItem | undefined {
  return ROADMAP.find((i) => i.id === id);
}
