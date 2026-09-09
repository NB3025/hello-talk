import { describe, expect, it } from 'vitest';
import {
  addedMe,
  chatsOf,
  chatTitle,
  directChatBetween,
  findUserByCode,
  friendsOf,
  normalizeCode,
  totalUnread,
  unreadCount,
} from './selectors';
import { emptyDb, type Db, type User } from './types';

const user = (id: string, name: string, code: string): User => ({
  id,
  code,
  name,
  statusMessage: '',
  hue: '#eee',
  createdAt: 0,
});

const base = (): Db => ({
  ...emptyDb(),
  users: [user('a', '테스트A', 'HT-AAAA'), user('b', '테스트B', 'HT-BBBB'), user('c', '테스트C', 'HT-CCCC')],
});

describe('normalizeCode', () => {
  it('대소문자와 하이픈·공백 차이를 무시한다', () => {
    expect(normalizeCode(' ht-gdng ')).toBe('HTGDNG');
    expect(normalizeCode('HTGDNG')).toBe('HTGDNG');
  });

  it('빈 문자열은 빈 문자열로 남는다', () => {
    expect(normalizeCode('  -  ')).toBe('');
  });
});

describe('findUserByCode', () => {
  it('사람이 손으로 입력한 형태를 그대로 찾는다', () => {
    const db = base();
    expect(findUserByCode(db, 'ht bbbb')?.name).toBe('테스트B');
    expect(findUserByCode(db, 'HT-BBBB')?.name).toBe('테스트B');
  });

  it('없는 코드는 undefined', () => {
    expect(findUserByCode(base(), 'HT-ZZZZ')).toBeUndefined();
  });

  it('빈 입력으로 아무나 집어오지 않는다', () => {
    expect(findUserByCode(base(), '   ')).toBeUndefined();
  });
});

describe('친구 관계는 단방향이다', () => {
  it('내가 등록해도 상대의 친구 목록에는 내가 없다', () => {
    const db = base();
    db.friendships.push({ ownerId: 'a', friendId: 'b', createdAt: 1, favorite: false });

    expect(friendsOf(db, 'a').map((u) => u.id)).toEqual(['b']);
    expect(friendsOf(db, 'b')).toEqual([]);
  });

  it('나를 등록한 사람은 addedMe 에 나오고, 내가 등록하면 사라진다', () => {
    const db = base();
    db.friendships.push({ ownerId: 'b', friendId: 'a', createdAt: 1, favorite: false });
    expect(addedMe(db, 'a').map((u) => u.id)).toEqual(['b']);

    db.friendships.push({ ownerId: 'a', friendId: 'b', createdAt: 2, favorite: false });
    expect(addedMe(db, 'a')).toEqual([]);
  });
});

describe('안읽음 계산', () => {
  const withChat = (): Db => {
    const db = base();
    db.chats.push({ id: 'r1', memberIds: ['a', 'b'], createdAt: 0 });
    db.messages.push(
      { id: 'm1', chatId: 'r1', senderId: 'b', text: '안녕', createdAt: 100 },
      { id: 'm2', chatId: 'r1', senderId: 'b', text: '뭐해', createdAt: 200 },
      { id: 'm3', chatId: 'r1', senderId: 'a', text: '일해', createdAt: 300 },
    );
    return db;
  };

  it('내가 보낸 메시지는 내 안읽음에 들어가지 않는다', () => {
    const db = withChat();
    expect(unreadCount(db, 'r1', 'a')).toBe(2);
    expect(unreadCount(db, 'r1', 'b')).toBe(1);
  });

  it('읽은 시각 이후 메시지만 센다', () => {
    const db = withChat();
    db.reads.push({ chatId: 'r1', userId: 'a', lastReadAt: 150 });
    expect(unreadCount(db, 'r1', 'a')).toBe(1);
  });

  it('전체 안읽음은 방별 합계다', () => {
    const db = withChat();
    db.chats.push({ id: 'r2', memberIds: ['a', 'c'], createdAt: 0 });
    db.messages.push({ id: 'm4', chatId: 'r2', senderId: 'c', text: '하이', createdAt: 400 });
    expect(totalUnread(db, 'a')).toBe(3);
  });
});

describe('대화방', () => {
  it('최근 메시지가 있는 방이 위로 온다', () => {
    const db = base();
    db.chats.push(
      { id: 'old', memberIds: ['a', 'b'], createdAt: 0 },
      { id: 'new', memberIds: ['a', 'c'], createdAt: 0 },
    );
    db.messages.push(
      { id: 'm1', chatId: 'old', senderId: 'b', text: '옛것', createdAt: 100 },
      { id: 'm2', chatId: 'new', senderId: 'c', text: '새것', createdAt: 900 },
    );
    expect(chatsOf(db, 'a').map((c) => c.id)).toEqual(['new', 'old']);
  });

  it('1:1 방은 순서와 무관하게 같은 방으로 찾힌다', () => {
    const db = base();
    db.chats.push({ id: 'r1', memberIds: ['a', 'b'], createdAt: 0 });
    expect(directChatBetween(db, 'a', 'b')?.id).toBe('r1');
    expect(directChatBetween(db, 'b', 'a')?.id).toBe('r1');
  });

  it('제목이 있는 그룹방은 1:1 조회에 걸리지 않는다', () => {
    const db = base();
    db.chats.push({ id: 'g', memberIds: ['a', 'b'], createdAt: 0, title: '둘만의 그룹' });
    expect(directChatBetween(db, 'a', 'b')).toBeUndefined();
  });

  it('1:1 방 제목은 보는 사람에 따라 상대 이름이 된다', () => {
    const db = base();
    const chat = { id: 'r1', memberIds: ['a', 'b'], createdAt: 0 };
    db.chats.push(chat);
    expect(chatTitle(db, chat, 'a')).toBe('테스트B');
    expect(chatTitle(db, chat, 'b')).toBe('테스트A');
  });
});
