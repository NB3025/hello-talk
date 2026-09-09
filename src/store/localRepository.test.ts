import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository, type KeyValueStore } from './localRepository';
import { messagesOf, unreadCount } from '../domain/selectors';

/** 두 탭이 같은 localStorage 를 본다는 상황을 그대로 재현하는 가짜 저장소. */
class MemoryStore implements KeyValueStore {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

const make = (store: KeyValueStore) => new LocalRepository(store, { broadcast: false });

describe('createUser', () => {
  let repo: LocalRepository;
  beforeEach(() => {
    repo = make(new MemoryStore());
  });

  it('친구 코드를 발급하고 목록에 넣는다', () => {
    const u = repo.createUser('테스트유저', '오늘도 화이팅');
    expect(u.code).toMatch(/^HT-[A-Z2-9]{4}$/);
    expect(repo.snapshot().users.some((x) => x.id === u.id)).toBe(true);
  });

  it('공백만 있는 이름은 거부한다', () => {
    expect(() => repo.createUser('   ')).toThrow();
  });

  it('이름 앞뒤 공백을 정리한다', () => {
    expect(repo.createUser('  테스트유저  ').name).toBe('테스트유저');
  });
});

describe('addFriendByCode', () => {
  let repo: LocalRepository;
  let meId: string;
  beforeEach(() => {
    repo = make(new MemoryStore());
    meId = repo.createUser('테스트유저').id;
  });

  it('데모 계정 코드로 등록된다', () => {
    const r = repo.addFriendByCode(meId, 'ht-gdng');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.friend.name).toBe('홍길동');
  });

  it('없는 코드는 이유를 문장으로 돌려준다', () => {
    const r = repo.addFriendByCode(meId, 'HT-ZZZZ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('없습니다');
  });

  it('내 코드는 등록할 수 없다', () => {
    const me = repo.snapshot().users.find((u) => u.id === meId)!;
    const r = repo.addFriendByCode(meId, me.code);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('내 코드');
  });

  it('같은 사람을 두 번 등록하지 않는다', () => {
    repo.addFriendByCode(meId, 'HT-GDNG');
    const again = repo.addFriendByCode(meId, 'HT-GDNG');
    expect(again.ok).toBe(false);
    expect(repo.snapshot().friendships).toHaveLength(1);
  });

  it('빈 입력을 거부한다', () => {
    expect(repo.addFriendByCode(meId, '  ').ok).toBe(false);
  });
});

describe('대화', () => {
  let repo: LocalRepository;
  let me: string;
  let other: string;
  beforeEach(() => {
    repo = make(new MemoryStore());
    me = repo.createUser('테스트유저').id;
    other = repo.snapshot().users.find((u) => u.code === 'HT-GDNG')!.id;
  });

  it('같은 두 사람 사이에 방이 두 개 생기지 않는다', () => {
    const first = repo.openDirectChat(me, other);
    const second = repo.openDirectChat(other, me);
    expect(second).toBe(first);
    expect(repo.snapshot().chats).toHaveLength(1);
  });

  it('메시지를 보내면 방에 쌓인다', () => {
    const chat = repo.openDirectChat(me, other);
    repo.sendMessage(chat, me, '안녕');
    repo.sendMessage(chat, other, '어 안녕');
    expect(messagesOf(repo.snapshot(), chat).map((m) => m.text)).toEqual(['안녕', '어 안녕']);
  });

  it('빈 메시지는 보내지 않는다', () => {
    const chat = repo.openDirectChat(me, other);
    repo.sendMessage(chat, me, '   \n ');
    expect(repo.snapshot().messages).toHaveLength(0);
  });

  it('방 멤버가 아니면 보낼 수 없다', () => {
    const chat = repo.openDirectChat(me, other);
    const stranger = repo.snapshot().users.find((u) => u.code === 'HT-CHSU')!.id;
    repo.sendMessage(chat, stranger, '끼어들기');
    expect(repo.snapshot().messages).toHaveLength(0);
  });

  it('보낸 사람에게는 자기 메시지가 안읽음으로 남지 않는다', () => {
    const chat = repo.openDirectChat(me, other);
    repo.sendMessage(chat, me, '안녕');
    expect(unreadCount(repo.snapshot(), chat, me)).toBe(0);
    expect(unreadCount(repo.snapshot(), chat, other)).toBe(1);
  });

  it('markRead 후 안읽음이 0 이 된다', () => {
    const chat = repo.openDirectChat(me, other);
    repo.sendMessage(chat, other, '안녕');
    expect(unreadCount(repo.snapshot(), chat, me)).toBe(1);
    repo.markRead(chat, me);
    expect(unreadCount(repo.snapshot(), chat, me)).toBe(0);
  });
});

describe('두 탭 동기화', () => {
  it('한쪽이 보낸 메시지를 다른 쪽이 저장소에서 다시 읽어 본다', () => {
    // 같은 저장소를 공유하는 두 인스턴스 = 두 탭.
    const store = new MemoryStore();
    const tabA = make(store);
    const me = tabA.createUser('테스트유저').id;
    const other = tabA.snapshot().users.find((u) => u.code === 'HT-GDNG')!.id;
    const chat = tabA.openDirectChat(me, other);

    const tabB = make(store);
    tabB.sendMessage(chat, other, '다른 탭에서 보냄');

    // 탭 A 의 다음 쓰기는 저장소를 다시 읽으므로 탭 B 의 메시지를 잃지 않는다.
    tabA.sendMessage(chat, me, '받았어');
    expect(messagesOf(tabA.snapshot(), chat).map((m) => m.text)).toEqual([
      '다른 탭에서 보냄',
      '받았어',
    ]);
  });
});

describe('알림은 내용이 바뀔 때만 낸다 (React #185 무한 루프 회귀)', () => {
  it('읽을 것이 없으면 markRead 가 구독자를 깨우지 않는다', () => {
    const repo = make(new MemoryStore());
    const me = repo.createUser('테스트유저').id;
    const other = repo.snapshot().users.find((u) => u.code === 'HT-GDNG')!.id;
    const chat = repo.openDirectChat(me, other);

    let woken = 0;
    repo.subscribe(() => {
      woken += 1;
    });

    // 안읽음이 0 인 방에서 여러 번 불러도 알림이 나가지 않아야 한다.
    repo.markRead(chat, me);
    repo.markRead(chat, me);
    repo.markRead(chat, me);
    expect(woken).toBe(0);
  });

  it('읽을 것이 있으면 한 번만 깨우고, 그 뒤로는 조용하다', () => {
    const repo = make(new MemoryStore());
    const me = repo.createUser('테스트유저').id;
    const other = repo.snapshot().users.find((u) => u.code === 'HT-GDNG')!.id;
    const chat = repo.openDirectChat(me, other);
    repo.sendMessage(chat, other, '안녕');

    let woken = 0;
    repo.subscribe(() => {
      woken += 1;
    });

    repo.markRead(chat, me);
    expect(woken).toBe(1);
    repo.markRead(chat, me);
    expect(woken).toBe(1);
  });

  it('없는 방에 markRead 를 불러도 조용히 지나간다', () => {
    const repo = make(new MemoryStore());
    const me = repo.createUser('테스트유저').id;
    let woken = 0;
    repo.subscribe(() => {
      woken += 1;
    });
    repo.markRead('없는-방', me);
    expect(woken).toBe(0);
  });

  it('아무것도 바꾸지 않는 쓰기는 알림을 내지 않는다', () => {
    const repo = make(new MemoryStore());
    const me = repo.createUser('테스트유저').id;
    const other = repo.snapshot().users.find((u) => u.code === 'HT-GDNG')!.id;

    let woken = 0;
    repo.subscribe(() => {
      woken += 1;
    });
    repo.sendMessage(repo.openDirectChat(me, other), me, '   '); // 빈 메시지
    repo.toggleFavorite(me, '없는-사람');
    repo.removeFriend(me, '없는-사람');
    expect(woken).toBe(1); // openDirectChat 이 방을 만든 것 하나뿐
  });
});

describe('다른 탭이 먼저 만든 방', () => {
  it('내 스냅샷이 뒤처져 있어도 실재하는 방 id 를 돌려준다', () => {
    const store = new MemoryStore();
    const tabA = make(store);
    const me = tabA.createUser('테스트유저').id;
    const other = tabA.snapshot().users.find((u) => u.code === 'HT-GDNG')!.id;

    // 탭 B 가 먼저 방을 만든다. 탭 A 는 알림을 못 받은 상태(브로드캐스트 끔).
    const tabB = make(store);
    const madeByB = tabB.openDirectChat(me, other);

    const seenByA = tabA.openDirectChat(me, other);
    expect(seenByA).toBe(madeByB);
    // 돌려준 id 가 실재해야 한다 — 여기서 유령 id 를 주면 대화방이 열리지 않는다.
    expect(tabA.snapshot().chats.some((c) => c.id === seenByA)).toBe(true);
    expect(tabA.snapshot().chats).toHaveLength(1);
  });
});

describe('reset', () => {
  it('사람·친구·대화를 비우고 데모 사용자만 남긴다', () => {
    const repo = make(new MemoryStore());
    const me = repo.createUser('테스트유저').id;
    repo.addFriendByCode(me, 'HT-GDNG');
    repo.openDirectChat(me, repo.snapshot().users.find((u) => u.code === 'HT-GDNG')!.id);

    repo.reset();
    const db = repo.snapshot();
    expect(db.friendships).toHaveLength(0);
    expect(db.chats).toHaveLength(0);
    expect(db.users.some((u) => u.name === '테스트유저')).toBe(false);
    expect(db.users).toHaveLength(4);
  });
});
