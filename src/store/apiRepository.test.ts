import { describe, expect, it, vi } from 'vitest';
import { ApiRepository, type WebSocketLike } from './apiRepository';
import { emptyDb, type Db, type User } from '../domain/types';
import { newGiftOrder } from '../domain/gift';
import { messagesOf, unreadCount } from '../domain/selectors';
import { PRODUCTS } from '../domain/products';

/**
 * 서버를 인메모리로 흉내내는 가짜 백엔드.
 * ApiRepository 가 fetch 로 무엇을 요청하는지에 따라 이 db 를 바꾸고,
 * GET /api/snapshot 으로 그 상태를 돌려준다. WebSocket 변경 신호도 밀어줄 수 있다.
 */
class FakeBackend {
  db: Db = emptyDb();
  sockets = new Set<FakeSocket>();
  /** 특정 경로를 강제로 거절시키고 싶을 때. */
  reject = new Set<string>();
  /** dev 전용 사용자 디렉터리(/api/dev/users)를 열지 여부. */
  devTools = true;
  /** 스냅샷이 세션을 요구하는지(서버 모드 로그인 전 401 을 흉내). */
  requireSessionForSnapshot = false;
  /** requireSessionForSnapshot 이 켜졌을 때 세션이 있는지. */
  hasSession = false;
  /** 운영처럼 현재 사용자와 친구만 스냅샷에 포함할지. */
  scopeSnapshots = false;

  makeUser(name: string): User {
    const u: User = {
      id: `srv-${name}-${this.db.users.length}`,
      code: `HT-${name.slice(0, 4).toUpperCase().padEnd(4, 'X')}`,
      name,
      statusMessage: '',
      hue: '#BFE3C9',
      createdAt: Date.now(),
    };
    this.db.users.push(u);
    return u;
  }

  broadcast(scope: string): void {
    const payload = JSON.stringify({ type: 'change', scope });
    for (const s of this.sockets) s.emitMessage(payload);
  }

  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    const json = (status: number, data: unknown): Response =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    if (this.reject.has(`${method} ${path}`)) {
      return json(200, { ok: false, reason: '서버가 거절함' });
    }

    if (path === '/api/snapshot' && method === 'GET') {
      if (this.requireSessionForSnapshot && !this.hasSession) {
        return json(401, { error: '로그인이 필요합니다.' });
      }
      if (!this.scopeSnapshots) return json(200, { db: this.db });

      const owner = this.db.users[0];
      if (!owner) return json(200, { db: emptyDb() });
      const scoped = structuredClone(this.db);
      const friendIds = new Set(
        scoped.friendships.filter((f) => f.ownerId === owner.id).map((f) => f.friendId),
      );
      scoped.users = scoped.users.filter((u) => u.id === owner.id || friendIds.has(u.id));
      scoped.friendships = scoped.friendships.filter(
        (f) => f.ownerId === owner.id || f.friendId === owner.id,
      );
      return json(200, { db: scoped });
    }
    // dev 전용 사용자 디렉터리. 로그인 화면 목록용. 세션 없이도 열린다(devTools).
    if (path === '/api/dev/users' && method === 'GET') {
      if (!this.devTools) return json(404, { error: 'unknown' });
      return json(200, { users: this.db.users });
    }
    if (path === '/api/auth/session' && method === 'POST') {
      if (body.userId) {
        const u = this.db.users.find((x) => x.id === body.userId);
        return u ? json(200, { user: u }) : json(404, { error: 'no' });
      }
      const u = this.makeUser(String(body.name));
      this.hasSession = true;
      this.broadcast('users');
      return json(201, { user: u });
    }
    if (path === '/api/auth/me' && method === 'GET') {
      const u = this.db.users[0];
      return u ? json(200, { user: u }) : json(401, { error: 'no' });
    }
    if (path === '/api/friends' && method === 'POST') {
      const normalized = String(body.code).replace(/[\s-]/g, '').toUpperCase();
      const friend = this.db.users.find(
        (u) => u.code.replace(/[\s-]/g, '').toUpperCase() === normalized,
      );
      const owner = this.db.users[0];
      if (!friend || !owner) return json(200, { ok: false, reason: '사용자가 없습니다.' });
      if (!this.db.friendships.some((f) => f.ownerId === owner.id && f.friendId === friend.id)) {
        this.db.friendships.push({
          ownerId: owner.id,
          friendId: friend.id,
          createdAt: Date.now(),
          favorite: false,
        });
      }
      this.broadcast('friends');
      return json(200, { ok: true, friend });
    }
    if (path === '/api/chats/direct' && method === 'POST') {
      // 서버는 결정론적 방 id 를 준다.
      const targetId = String(body.targetId);
      const chatId = `srv-chat-${targetId}`;
      if (!this.db.chats.some((c) => c.id === chatId)) {
        this.db.chats.push({ id: chatId, memberIds: [this.db.users[0]?.id ?? 'me', targetId], createdAt: Date.now() });
        this.broadcast('chats');
      }
      return json(200, { chatId });
    }
    if (/^\/api\/chats\/[^/]+\/messages$/.test(path) && method === 'POST') {
      const chatId = decodeURIComponent(path.split('/')[3] ?? '');
      const senderId = this.db.users[0]?.id ?? 'me';
      this.db.messages.push({
        id: `srv-message-${this.db.messages.length}`,
        chatId,
        senderId,
        text: String(body.text),
        createdAt: Date.now(),
      });
      this.broadcast('messages');
      return json(200, { ok: true, messageId: this.db.messages.at(-1)?.id });
    }
    if (/^\/api\/chats\/[^/]+\/read$/.test(path) && method === 'POST') {
      return json(200, { ok: true });
    }
    if (path === '/api/gifts' && method === 'POST') {
      this.broadcast('gifts');
      return json(200, { ok: true, orderId: 'srv-order', chatId: 'srv-chat' });
    }
    if (/^\/api\/gifts\/[^/]+\/actions$/.test(path) && method === 'POST') {
      this.broadcast('gifts');
      return json(200, { ok: true, text: '완료' });
    }
    return json(404, { error: 'unknown' });
  };
}

class FakeSocket implements WebSocketLike {
  private listeners = new Map<string, ((ev: { data: unknown }) => void)[]>();
  constructor(private backend: FakeBackend) {
    backend.sockets.add(this);
  }
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: () => void): void;
  addEventListener(type: string, listener: (ev: { data: unknown }) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(listener);
    this.listeners.set(type, arr);
    if (type === 'open') queueMicrotask(() => (listener as () => void)());
  }
  emitMessage(data: string): void {
    (this.listeners.get('message') ?? []).forEach((l) => l({ data }));
  }
  close(): void {
    this.backend.sockets.delete(this);
    (this.listeners.get('close') ?? []).forEach((l) => (l as () => void)());
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

const make = (backend: FakeBackend, withWs = true) =>
  new ApiRepository({
    baseUrl: 'http://test.local',
    fetch: backend.fetch,
    makeWebSocket: withWs ? (() => new FakeSocket(backend)) : false,
  });

const gift = PRODUCTS[0]!;

describe('ApiRepository 하이드레이트', () => {
  it('생성 시 GET /api/snapshot 으로 미러를 채우고 한 번 알린다', async () => {
    const backend = new FakeBackend();
    backend.makeUser('홍길동');
    const repo = make(backend, false);

    let woken = 0;
    repo.subscribe(() => (woken += 1));
    await tick();

    expect(repo.snapshot().users.map((u) => u.name)).toEqual(['홍길동']);
    expect(woken).toBe(1);
    repo.dispose();
  });

  it('로그인 전(세션 없음)에도 /api/dev/users 로 로그인 목록을 채운다', async () => {
    // 서버 모드 회귀: 스코핑된 스냅샷은 로그인 전 세션이 없어 401 이라 미러가 비어 있다.
    // dev 사용자 디렉터리를 접어 넣어 LoginScreen 의 db.users 목록이 채워져야 한다.
    const backend = new FakeBackend();
    backend.requireSessionForSnapshot = true; // 로그인 전 스냅샷은 401
    backend.makeUser('홍길동');
    backend.makeUser('김철수');
    const repo = make(backend, false);
    await tick();

    // 스냅샷은 401 이었지만 디렉터리로 미러의 db.users 가 채워진다.
    expect(repo.snapshot().users.map((u) => u.name).sort()).toEqual(['김철수', '홍길동']);
    repo.dispose();
  });

  it('운영(devTools off)에서는 /api/dev/users 가 404 라 목록이 비어 있다', async () => {
    const backend = new FakeBackend();
    backend.devTools = false;
    backend.requireSessionForSnapshot = true;
    backend.makeUser('홍길동');
    const repo = make(backend, false);
    await tick();
    // 운영에서는 목록이 비어 있는 게 맞다({name} 으로 새 계정 생성).
    expect(repo.snapshot().users).toHaveLength(0);
    repo.dispose();
  });

  it('내용이 같은 스냅샷을 다시 받아도 알림을 내지 않는다 (React #185)', async () => {
    const backend = new FakeBackend();
    backend.makeUser('홍길동');
    const repo = make(backend, false);
    await tick();

    let woken = 0;
    repo.subscribe(() => (woken += 1));
    await repo.hydrate();
    await repo.hydrate();
    expect(woken).toBe(0);
    repo.dispose();
  });
  it('401 스냅샷은 오래된 미러를 지우고 세션 만료를 알린다', async () => {
    const backend = new FakeBackend();
    backend.devTools = false;
    backend.requireSessionForSnapshot = true;
    backend.hasSession = true;
    backend.makeUser('홍길동');
    const repo = make(backend, false);
    await tick();
    expect(repo.snapshot().users).toHaveLength(1);

    let expired = 0;
    repo.subscribeSessionExpired(() => (expired += 1));
    backend.hasSession = false;
    await repo.hydrate();

    expect(expired).toBe(1);
    expect(repo.snapshot()).toEqual(emptyDb());
    repo.dispose();
  });
});

describe('ApiRepository createUser', () => {
  it('서버가 확정한 사용자를 기다려 반환하고 같은 id 로 미러를 유지한다', async () => {
    const backend = new FakeBackend();
    const repo = make(backend, false);
    await tick();

    const user = await repo.createUser('새사람');
    expect(user.name).toBe('새사람');
    expect(user.id).toMatch(/^srv-/);
    expect(repo.snapshot().users.filter((x) => x.id === user.id)).toHaveLength(1);
    repo.dispose();
  });
});

describe('ApiRepository openDirectChat', () => {
  it('돌려준 방 id 는 재조정 후에도 그대로 실재하는 방을 가리킨다(유령 id 금지)', async () => {
    const backend = new FakeBackend();
    const me = backend.makeUser('나');
    const other = backend.makeUser('상대');
    const repo = make(backend, false);
    await tick();

    const chatId = repo.openDirectChat(me.id, other.id);
    // 돌려준 id 가 실재하는 방을 가리켜야 한다(유령 id 금지).
    expect(repo.snapshot().chats.some((c) => c.id === chatId)).toBe(true);

    await tick();
    // 서버 스냅샷이 서버 방 id 로 와도, 호출자가 들고 있는 id 는 그대로 유효하다:
    // 서버 id 는 별칭으로 접혀 미러는 안정된 id 하나로 유지된다(App 의 openChat 이
    // 유령 방을 가리키지 않는다).
    expect(repo.snapshot().chats.some((c) => c.id === chatId)).toBe(true);
    expect(repo.snapshot().chats).toHaveLength(1);
    // srv-chat-* 로 중복된 방이 생기지 않는다.
    expect(repo.snapshot().chats.some((c) => c.id === `srv-chat-${other.id}`)).toBe(false);
    repo.dispose();
  });

  it('이미 있는 방이면 같은(안정된) id 를 돌려준다', async () => {
    const backend = new FakeBackend();
    const me = backend.makeUser('나');
    const other = backend.makeUser('상대');
    const repo = make(backend, false);
    await tick();

    const first = repo.openDirectChat(me.id, other.id);
    await tick(); // 서버 id 는 별칭으로 접힌다.
    // 다시 열면 같은 안정된 id 를 돌려주고, 방은 하나뿐이다.
    const second = repo.openDirectChat(me.id, other.id);
    expect(second).toBe(first);
    expect(repo.snapshot().chats.some((c) => c.id === second)).toBe(true);
    expect(repo.snapshot().chats).toHaveLength(1);
    repo.dispose();
  });
});

describe('ApiRepository sendMessage', () => {
  it('새 방 서버 확정을 기다린 뒤 전송하고 미러를 갱신한다', async () => {
    const backend = new FakeBackend();
    const me = backend.makeUser('나');
    const other = backend.makeUser('상대');
    const spy = vi.spyOn(backend, 'fetch');
    const repo = make(backend, false);
    await tick();

    const chat = repo.openDirectChat(me.id, other.id);
    // openDirectChat 응답을 기다리지 않고 바로 보내도 sendMessage가 방 확정을 기다린다.
    const result = await repo.sendMessage(chat, me.id, '안녕');
    expect(result).toEqual({ ok: true });
    expect(messagesOf(repo.snapshot(), chat).map((m) => m.text)).toEqual(['안녕']);
    expect(unreadCount(repo.snapshot(), chat, me.id)).toBe(0);

    const posted = spy.mock.calls.find(
      ([url, init]) => /\/messages$/.test(String(url)) && init?.method === 'POST',
    );
    expect(decodeURIComponent(String(posted?.[0]))).toContain(`srv-chat-${other.id}`);
    repo.dispose();
  });

  it('빈 메시지는 미러도 서버도 건드리지 않는다', async () => {
    const backend = new FakeBackend();
    const me = backend.makeUser('나');
    const other = backend.makeUser('상대');
    const repo = make(backend, false);
    await tick();
    const chat = repo.openDirectChat(me.id, other.id);
    const result = await repo.sendMessage(chat, me.id, '   ');
    expect(result).toEqual({ ok: false, reason: '메시지를 입력해 주세요.' });
    expect(repo.snapshot().messages).toHaveLength(0);
    repo.dispose();
  });
  it('서버 거절 시 메시지를 추가하지 않고 실패 이유를 돌려준다', async () => {
    const backend = new FakeBackend();
    const me = backend.makeUser('나');
    const other = backend.makeUser('상대');
    const repo = make(backend, false);
    await tick();
    const chat = repo.openDirectChat(me.id, other.id);
    await tick();
    const serverChatId = `srv-chat-${other.id}`;
    backend.reject.add(`POST /api/chats/${encodeURIComponent(serverChatId)}/messages`);

    const result = await repo.sendMessage(chat, me.id, '실패해야 함');
    expect(result).toEqual({ ok: false, reason: '서버가 거절함' });
    expect(repo.snapshot().messages).toHaveLength(0);
    repo.dispose();
  });
});

describe('ApiRepository markRead 무한 루프 회귀', () => {
  it('읽을 것이 없으면 구독자를 깨우지 않는다', async () => {
    const backend = new FakeBackend();
    const me = backend.makeUser('나');
    const other = backend.makeUser('상대');
    const repo = make(backend, false);
    await tick();
    const chat = repo.openDirectChat(me.id, other.id);
    await tick();

    let woken = 0;
    repo.subscribe(() => (woken += 1));
    repo.markRead(chat, me.id);
    repo.markRead(chat, me.id);
    expect(woken).toBe(0);
    repo.dispose();
  });
});

describe('ApiRepository 선물', () => {
  it('gift accept 는 버블 상태를 accepted 로 바꾼다', async () => {
    const backend = new FakeBackend();
    const me = backend.makeUser('나');
    const other = backend.makeUser('상대');
    const repo = make(backend, false);
    await tick();

    const sent = repo.sendGift({
      senderId: me.id,
      receiverId: other.id,
      productId: gift.id,
      message: '축하해',
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    const accepted = repo.giftAction(sent.orderId, other.id, 'ACCEPT');
    expect(accepted.ok).toBe(true);
    const order = repo.snapshot().giftOrders.find((o) => o.id === sent.orderId);
    expect(order?.status).toBe('accepted');
    expect(order?.expiresAt).toBeGreaterThan(Date.now());
    repo.dispose();
  });

  it('자기 자신에게 보내면 검증 문구로 거절한다(서버 호출 없이)', async () => {
    const backend = new FakeBackend();
    const me = backend.makeUser('나');
    const repo = make(backend, false);
    await tick();
    const r = repo.sendGift({ senderId: me.id, receiverId: me.id, productId: gift.id, message: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('자기 자신');
    repo.dispose();
  });

  it('당사자가 아닌 선물 동작은 도메인 문구로 거절한다', async () => {
    const backend = new FakeBackend();
    const me = backend.makeUser('나');
    const other = backend.makeUser('상대');
    const stranger = backend.makeUser('제3자');
    const repo = make(backend, false);
    await tick();
    const sent = repo.sendGift({ senderId: me.id, receiverId: other.id, productId: gift.id, message: '' });
    if (!sent.ok) throw new Error('선물 실패');
    const r = repo.giftAction(sent.orderId, stranger.id, 'ACCEPT');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('당사자');
    repo.dispose();
  });

  it('FORCE_EXPIRE 는 로컬에서도 거절한다', async () => {
    const backend = new FakeBackend();
    const me = backend.makeUser('나');
    const other = backend.makeUser('상대');
    const repo = make(backend, false);
    await tick();
    const sent = repo.sendGift({ senderId: me.id, receiverId: other.id, productId: gift.id, message: '' });
    if (!sent.ok) throw new Error('선물 실패');
    repo.giftAction(sent.orderId, other.id, 'ACCEPT');
    const r = repo.giftAction(sent.orderId, other.id, 'FORCE_EXPIRE');
    expect(r.ok).toBe(false);
    repo.dispose();
  });

  it('서버가 선물 동작을 거절하면 낙관적 상태를 되돌린다', async () => {
    const backend = new FakeBackend();
    const me = backend.makeUser('나');
    const other = backend.makeUser('상대');
    // 서버 db 에 선물을 직접 심어 스냅샷 재조정이 롤백을 덮지 않게 한다.
    const repo = make(backend, false);
    await tick();
    const sent = repo.sendGift({ senderId: me.id, receiverId: other.id, productId: gift.id, message: '' });
    if (!sent.ok) throw new Error('선물 실패');
    // 서버 db 에도 같은 주문을 넣어 두면 스냅샷이 롤백 후 accepted 로 되돌리지 않는다.
    backend.db.giftOrders.push(
      newGiftOrder({
        id: sent.orderId,
        productId: gift.id,
        senderId: me.id,
        receiverId: other.id,
        chatId: sent.chatId,
        message: '',
        price: gift.price,
        at: Date.now(),
      }),
    );

    // 다음 actions 호출을 거절시킨다. WS/스냅샷은 없으므로(withWs=false) 롤백이 유지된다.
    backend.reject.add(`POST /api/gifts/${sent.orderId}/actions`);
    const r = repo.giftAction(sent.orderId, other.id, 'ACCEPT');
    // 낙관적으로는 성공 반환.
    expect(r.ok).toBe(true);
    expect(repo.snapshot().giftOrders.find((o) => o.id === sent.orderId)?.status).toBe('accepted');

    await tick();
    // 서버 거절 후 롤백되어 다시 paid.
    expect(repo.snapshot().giftOrders.find((o) => o.id === sent.orderId)?.status).toBe('paid');
    repo.dispose();
  });
});

describe('ApiRepository addFriendByCode', () => {
  it('운영 스코핑 미러에 없는 사람도 서버에서 코드로 찾아 추가한다', async () => {
    const backend = new FakeBackend();
    const me = backend.makeUser('나');
    const other = backend.makeUser('상대');
    backend.devTools = false;
    backend.requireSessionForSnapshot = true;
    backend.hasSession = true;
    backend.scopeSnapshots = true;
    const repo = make(backend, false);
    await tick();

    expect(repo.snapshot().users.map((u) => u.id)).toEqual([me.id]);
    const result = await repo.addFriendByCode(me.id, other.code);
    expect(result).toEqual({ ok: true, friend: other });
    expect(repo.snapshot().users.some((u) => u.id === other.id)).toBe(true);
    expect(repo.snapshot().friendships).toHaveLength(1);
    repo.dispose();
  });

  it('서버 거절 이유를 낙관적 성공으로 바꾸지 않는다', async () => {
    const backend = new FakeBackend();
    const me = backend.makeUser('나');
    const other = backend.makeUser('상대');
    const repo = make(backend, false);
    await tick();

    backend.reject.add('POST /api/friends');
    const result = await repo.addFriendByCode(me.id, other.code);
    expect(result).toEqual({ ok: false, reason: '서버가 거절함' });
    expect(repo.snapshot().friendships).toHaveLength(0);
    repo.dispose();
  });
});

describe('ApiRepository WebSocket', () => {
  it('change 신호를 받으면 스냅샷을 다시 받아 반영한다', async () => {
    const backend = new FakeBackend();
    const repo = make(backend, true);
    await tick();

    // 서버 상태를 바꾸고 change 신호를 밀어준다.
    backend.makeUser('새로운사람');
    backend.broadcast('users');
    await tick();
    await tick();

    expect(repo.snapshot().users.some((u) => u.name === '새로운사람')).toBe(true);
    repo.dispose();
  });
});

describe('ApiRepository reset', () => {
  it('운영 구현에는 reset 이 없다 — 던진다', async () => {
    const backend = new FakeBackend();
    const repo = make(backend, false);
    await tick();
    expect(() => repo.reset()).toThrow();
    repo.dispose();
  });
});
