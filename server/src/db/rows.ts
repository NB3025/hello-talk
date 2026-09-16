import type { Chat, Friendship, Message, ReadMark, User } from '../../../src/domain/types';
import type { GiftLedgerEntry, GiftOrder, StoredGiftStatus } from '../../../src/domain/gift';

/**
 * DB 행 <-> 도메인 객체 변환. 도메인 타입은 camelCase, DB 는 snake_case 이고
 * BIGINT 는 pg 가 문자열로 주므로 Number 로 되돌린다.
 */

interface UserRow {
  id: string;
  code: string;
  name: string;
  status_message: string;
  hue: string;
  created_at: string | number;
}

export const toUser = (r: UserRow): User => ({
  id: r.id,
  code: r.code,
  name: r.name,
  statusMessage: r.status_message,
  hue: r.hue,
  createdAt: Number(r.created_at),
});

interface FriendshipRow {
  owner_id: string;
  friend_id: string;
  created_at: string | number;
  favorite: boolean;
}

export const toFriendship = (r: FriendshipRow): Friendship => ({
  ownerId: r.owner_id,
  friendId: r.friend_id,
  createdAt: Number(r.created_at),
  favorite: r.favorite,
});

interface ChatRow {
  id: string;
  title: string | null;
  created_at: string | number;
  member_ids: string[];
}

export const toChat = (r: ChatRow): Chat => {
  const chat: Chat = {
    id: r.id,
    memberIds: r.member_ids ?? [],
    createdAt: Number(r.created_at),
  };
  if (r.title != null) chat.title = r.title;
  return chat;
};

interface MessageRow {
  id: string;
  chat_id: string;
  sender_id: string;
  text: string;
  created_at: string | number;
  kind: string | null;
  gift_order_id: string | null;
}

export const toMessage = (r: MessageRow): Message => {
  const m: Message = {
    id: r.id,
    chatId: r.chat_id,
    senderId: r.sender_id,
    text: r.text,
    createdAt: Number(r.created_at),
  };
  if (r.kind != null) m.kind = r.kind as 'text' | 'gift';
  if (r.gift_order_id != null) m.giftOrderId = r.gift_order_id;
  return m;
};

interface ReadRow {
  chat_id: string;
  user_id: string;
  last_read_at: string | number;
}

export const toRead = (r: ReadRow): ReadMark => ({
  chatId: r.chat_id,
  userId: r.user_id,
  lastReadAt: Number(r.last_read_at),
});

interface GiftOrderRow {
  id: string;
  product_id: string;
  sender_id: string;
  receiver_id: string;
  chat_id: string;
  message: string;
  price: string | number;
  status: string;
  paid_at: string | number;
  responded_at: string | number | null;
  expires_at: string | number | null;
  extensions_used: string | number;
  used_at: string | number | null;
  closed_by: string | null;
  refund_amount: string | number | null;
  ledger: GiftLedgerEntry[];
}

export const toGiftOrder = (r: GiftOrderRow): GiftOrder => {
  const o: GiftOrder = {
    id: r.id,
    productId: r.product_id,
    senderId: r.sender_id,
    receiverId: r.receiver_id,
    chatId: r.chat_id,
    message: r.message,
    price: Number(r.price),
    status: r.status as StoredGiftStatus,
    paidAt: Number(r.paid_at),
    extensionsUsed: Number(r.extensions_used),
    ledger: r.ledger ?? [],
  };
  if (r.responded_at != null) o.respondedAt = Number(r.responded_at);
  if (r.expires_at != null) o.expiresAt = Number(r.expires_at);
  if (r.used_at != null) o.usedAt = Number(r.used_at);
  if (r.closed_by != null) o.closedBy = r.closed_by;
  if (r.refund_amount != null) o.refundAmount = Number(r.refund_amount);
  return o;
};
