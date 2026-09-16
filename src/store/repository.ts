import type { ChatId, Db, User, UserId } from '../domain/types';
import type { GiftAction } from '../domain/gift';

/**
 * 앱이 데이터에 닿는 유일한 창구.
 * 지금 구현은 localStorage + BroadcastChannel 이지만, UI 는 그 사실을 모른다.
 * 서버를 붙일 때 이 인터페이스를 구현한 클래스를 하나 더 만들어 갈아끼운다.
 */
export type RepositoryResult<T> = T | Promise<T>;

export interface Repository {
  /** 현재 스냅샷. 내용이 바뀌지 않았다면 반드시 같은 참조를 돌려준다. */
  snapshot(): Db;
  /** 데이터가 바뀔 때마다 호출된다. 다른 탭에서 바뀐 경우도 포함한다. */
  subscribe(listener: () => void): () => void;

  /** 로컬은 즉시, 서버는 권위 있는 응답을 받은 뒤 사용자를 돌려준다. */
  createUser(name: string, statusMessage?: string): RepositoryResult<User>;
  /** 친구 코드로 등록. 서버 모드에서는 서버만 아는 코드를 조회한 뒤 결과를 돌려준다. */
  addFriendByCode(ownerId: UserId, code: string): RepositoryResult<AddFriendResult>;
  toggleFavorite(ownerId: UserId, friendId: UserId): void;
  removeFriend(ownerId: UserId, friendId: UserId): void;

  /** 이미 있으면 그 방을, 없으면 새로 만들어 방 id 를 돌려준다. */
  openDirectChat(a: UserId, b: UserId): ChatId;
  sendMessage(chatId: ChatId, senderId: UserId, text: string): void;
  markRead(chatId: ChatId, userId: UserId): void;

  /**
   * 결제하고 보낸다. 1:1 방을 열고(없으면 만들고) 그 방에 선물 버블을 남긴다 —
   * 선물은 언제나 대화 위에서 전달되므로 주문과 메시지가 한 번에 생겨야 한다.
   */
  sendGift(input: SendGiftInput): SendGiftResult;

  /**
   * 선물에 대한 모든 후속 동작을 하나로 받는다. 어떤 동작이 지금 합법인지는
   * 도메인의 `checkGiftAction` 이 이미 표로 들고 있어서, 메서드를 동작마다 쪼개면
   * 그 표가 두 곳에 생긴다.
   */
  giftAction(orderId: string, actorId: UserId, action: GiftAction): GiftCommandResult;

  /** 데모 초기화용. 프로덕션 구현에는 없어야 한다. */
  reset(): void;
}

export interface SendGiftInput {
  senderId: UserId;
  receiverId: UserId;
  productId: string;
  message: string;
}

export type SendGiftResult =
  | { ok: true; orderId: string; chatId: ChatId }
  | { ok: false; reason: string };

export type GiftCommandResult = { ok: true; text: string } | { ok: false; reason: string };

export type AddFriendResult =
  | { ok: true; friend: User }
  | { ok: false; reason: string };
