import type { Chat, ChatId, Db, Message, User, UserId } from './types';

/** 친구 코드는 대소문자·하이픈 차이를 무시하고 비교한다. 사람이 손으로 입력하는 값이다. */
export const normalizeCode = (raw: string): string =>
  raw.trim().toUpperCase().replace(/[\s-]/g, '');

export const userById = (db: Db, id: UserId): User | undefined =>
  db.users.find((u) => u.id === id);

export const findUserByCode = (db: Db, rawCode: string): User | undefined => {
  const wanted = normalizeCode(rawCode);
  if (!wanted) return undefined;
  return db.users.find((u) => normalizeCode(u.code) === wanted);
};

export const isFriend = (db: Db, ownerId: UserId, friendId: UserId): boolean =>
  db.friendships.some((f) => f.ownerId === ownerId && f.friendId === friendId);

export const friendsOf = (db: Db, ownerId: UserId): User[] =>
  db.friendships
    .filter((f) => f.ownerId === ownerId)
    .map((f) => userById(db, f.friendId))
    .filter((u): u is User => Boolean(u))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

export const favoritesOf = (db: Db, ownerId: UserId): User[] =>
  db.friendships
    .filter((f) => f.ownerId === ownerId && f.favorite)
    .map((f) => userById(db, f.friendId))
    .filter((u): u is User => Boolean(u))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

/**
 * 나를 등록했지만 내가 아직 등록하지 않은 사람들.
 * 친구 관계가 단방향이라 존재하는 개념이고, 등록 유도의 진입점이 된다.
 */
export const addedMe = (db: Db, meId: UserId): User[] =>
  db.friendships
    .filter((f) => f.friendId === meId && !isFriend(db, meId, f.ownerId))
    .map((f) => userById(db, f.ownerId))
    .filter((u): u is User => Boolean(u));

export const messagesOf = (db: Db, chatId: ChatId): Message[] =>
  db.messages.filter((m) => m.chatId === chatId).sort((a, b) => a.createdAt - b.createdAt);

export const lastMessage = (db: Db, chatId: ChatId): Message | undefined => {
  const list = messagesOf(db, chatId);
  return list[list.length - 1];
};

export const lastReadAt = (db: Db, chatId: ChatId, userId: UserId): number =>
  db.reads.find((r) => r.chatId === chatId && r.userId === userId)?.lastReadAt ?? 0;

/** 내가 보낸 메시지는 안읽음에 넣지 않는다. */
export const unreadCount = (db: Db, chatId: ChatId, userId: UserId): number => {
  const since = lastReadAt(db, chatId, userId);
  return db.messages.filter(
    (m) => m.chatId === chatId && m.senderId !== userId && m.createdAt > since,
  ).length;
};

export const chatsOf = (db: Db, userId: UserId): Chat[] =>
  db.chats
    .filter((c) => c.memberIds.includes(userId))
    .sort((a, b) => {
      const ta = lastMessage(db, a.id)?.createdAt ?? a.createdAt;
      const tb = lastMessage(db, b.id)?.createdAt ?? b.createdAt;
      return tb - ta;
    });

export const totalUnread = (db: Db, userId: UserId): number =>
  chatsOf(db, userId).reduce((sum, c) => sum + unreadCount(db, c.id, userId), 0);

/** 1:1 대화방을 찾는다. 같은 두 사람 사이에 방이 두 개 생기면 안 된다. */
export const directChatBetween = (db: Db, a: UserId, b: UserId): Chat | undefined =>
  db.chats.find(
    (c) => !c.title && c.memberIds.length === 2 && c.memberIds.includes(a) && c.memberIds.includes(b),
  );

export const counterpartsOf = (db: Db, chat: Chat, viewerId: UserId): User[] =>
  chat.memberIds
    .filter((id) => id !== viewerId)
    .map((id) => userById(db, id))
    .filter((u): u is User => Boolean(u));

export const chatTitle = (db: Db, chat: Chat, viewerId: UserId): string => {
  if (chat.title) return chat.title;
  const others = counterpartsOf(db, chat, viewerId);
  if (others.length === 0) return '나와의 채팅';
  return others.map((u) => u.name).join(', ');
};
