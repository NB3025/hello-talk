/**
 * 도메인 타입. 여기에 DOM·React·저장소 구현이 새어들어오지 않게 유지한다.
 * 나중에 서버로 옮길 때 그대로 따라가는 부분이 이 파일이다.
 */

// 선물 주문은 상태기계가 딸려 있어 gift.ts 에 따로 산다. gift.ts 도 여기서 Db 를
// 가져가므로 서로를 참조하지만, 양쪽 모두 `import type` 이라 컴파일 후 런타임
// 의존은 남지 않는다.
import type { GiftOrder } from './gift';

export type UserId = string;
export type ChatId = string;

export interface User {
  id: UserId;
  /** 친구 등록에 쓰는 사람이 읽을 수 있는 코드. 예: HT-4F2K */
  code: string;
  name: string;
  statusMessage: string;
  /** 아바타 배경색. 사진 업로드 대신 결정론적 색을 쓴다. */
  hue: string;
  createdAt: number;
}

/**
 * 단방향이다. 내가 상대를 등록해도 상대의 친구 목록에는 내가 없다 —
 * 카카오톡과 같고, 그래서 "나를 추가한 친구" 개념이 성립한다.
 */
export interface Friendship {
  ownerId: UserId;
  friendId: UserId;
  createdAt: number;
  favorite: boolean;
}

export interface Chat {
  id: ChatId;
  memberIds: UserId[];
  createdAt: number;
  /** 그룹 대화만 제목을 갖는다. 1:1 은 상대 이름으로 표시한다. */
  title?: string;
}

export interface Message {
  id: string;
  chatId: ChatId;
  senderId: UserId;
  text: string;
  createdAt: number;
  /**
   * 없으면 일반 텍스트다. 기존 메시지를 마이그레이션하지 않아도 되도록 옵셔널로 둔다 —
   * `kind === 'gift'` 인 메시지만 `giftOrderId` 를 갖는다.
   */
  kind?: 'text' | 'gift';
  giftOrderId?: string;
}

/** 대화방별 마지막으로 읽은 시각. 안읽음 개수는 이것으로 계산한다. */
export interface ReadMark {
  chatId: ChatId;
  userId: UserId;
  lastReadAt: number;
}

export interface Db {
  users: User[];
  friendships: Friendship[];
  chats: Chat[];
  messages: Message[];
  reads: ReadMark[];
  /** 선물 주문. 상품 카탈로그는 코드에 있고 여기 복사하지 않는다. */
  giftOrders: GiftOrder[];
}

export const emptyDb = (): Db => ({
  users: [],
  friendships: [],
  chats: [],
  messages: [],
  reads: [],
  giftOrders: [],
});
