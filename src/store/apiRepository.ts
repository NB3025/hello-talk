import { newId } from '../domain/ids';
import { applyGiftAction, checkGiftAction, newGiftOrder, type GiftAction } from '../domain/gift';
import { productById } from '../domain/products';
import { directChatBetween, normalizeCode, unreadCount } from '../domain/selectors';
import { emptyDb, type ChatId, type Db, type User, type UserId } from '../domain/types';
import type {
  AddFriendResult,
  GiftCommandResult,
  Repository,
  SendGiftInput,
  SendGiftResult,
  SendMessageResult,
} from './repository';

/**
 * 서버(FEAT-002)를 뒤에 둔 저장소. 렌더 경로는 동기 인메모리 Db 미러를 쓰고,
 * 서버만 답할 수 있는 사용자 생성·친구 코드 등록은 권위 있는 응답을 기다린다.
 *
 * - GET /api/snapshot + /ws 변경 신호로 미러를 최신 상태로 유지한다.
 * - 사용자 생성과 친구 등록은 임시 id/스코핑된 미러 추측을 만들지 않고 서버 결과를 반환한다.
 * - 나머지 즉시 UI 명령은 미러를 낙관적으로 갱신하고 서버 응답으로 재조정한다.
 * - 내용이 같으면 emit 하지 않아 useSyncExternalStore의 참조 계약과 React #185 회귀를 지킨다.
 *
 * LocalRepository 와 같은 무한 루프 회귀 방지 규율: 직렬화 문자열이 실제로 달라졌을
 * 때만 구독자에게 알린다(React #185).
 */

/** 테스트에서 fetch/WebSocket 을 주입할 수 있게 좁게 잡은 형태. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface WebSocketLike {
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: () => void): void;
  close(): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface ApiRepositoryOptions {
  /** 예: http://127.0.0.1:8787 . 끝의 / 는 무시한다. */
  baseUrl: string;
  fetch?: FetchLike;
  /** false 면 WebSocket 을 열지 않는다(테스트에서 명시 주입할 때 유용). */
  makeWebSocket?: WebSocketFactory | false;
}

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

const defaultWebSocket: WebSocketFactory = (url) => {
  const ws = new WebSocket(url);
  return ws as unknown as WebSocketLike;
};

export class ApiRepository implements Repository {
  private db: Db = emptyDb();
  /** 구독자가 현재 보고 있는 내용. 알림을 낼지 판단하는 기준. */
  private serialized = JSON.stringify(this.db);
  private listeners = new Set<() => void>();

  private readonly base: string;
  private readonly fetchImpl: FetchLike;
  private readonly makeWs: WebSocketFactory | false;
  private ws: WebSocketLike | null = null;
  private disposed = false;
  /**
   * 낙관적으로 연 1:1 방의 임시 id → 서버가 확정한 방 id 매핑.
   * 호출자에게 돌려준 임시 id 는 미러 안에서 안정적으로 유지하고(그 id 로 연 화면이 유령
   * 방을 가리키지 않게), 서버로 나가는 요청·서버에서 오는 스냅샷은 이 매핑으로 번역한다.
   */
  private chatIdAliases = new Map<ChatId, ChatId>();
  /** 임시 방 id가 서버 방 id로 확정될 때까지 메시지 전송이 기다리는 Promise. */
  private chatReady = new Map<ChatId, Promise<ChatId | null>>();
  /** 겹치는 스냅샷 재요청이 순서 뒤집히지 않도록 직렬화한다. */
  private refreshChain: Promise<void> = Promise.resolve();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionExpired = false;
  private sessionListeners = new Set<() => void>();

  constructor(options: ApiRepositoryOptions) {
    this.base = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? defaultFetch;
    this.makeWs =
      options.makeWebSocket === undefined ? defaultWebSocket : options.makeWebSocket;
    // 데모 로그인 화면의 "이미 있는 사람으로 들어가기" 목록을 채우려면 로그인 전(세션 없음)에
    // 전체 사용자 디렉터리가 필요하다. 스코핑된 스냅샷에는 남의 사용자가 없으므로, dev 백엔드가
    // 여는 /api/dev/users 로 미러의 db.users 를 채운다(운영에서는 404 → 목록은 비어 있고,
    // 그게 맞다: 운영 사용자는 {name} 으로 새 계정을 만든다).
    void this.loadDirectory();
    // 초기 하이드레이트 + 실시간 연결.
    void this.hydrate();
    this.connect();
  }

  /**
   * dev 전용 사용자 디렉터리(/api/dev/users)를 미러의 db.users 로 접어 넣는다.
   * 로그인 화면(LoginScreen)이 db.users 를 그대로 읽으므로 이 한 번의 병합으로
   * 서버 모드에서도 "이미 있는 사람으로 들어가기" 목록이 채워진다.
   * 운영에서는 404(devTools off) 이므로 조용히 넘어간다.
   */
  async loadDirectory(): Promise<void> {
    try {
      const res = await this.fetchImpl(`${this.base}/api/dev/users`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = (await res.json()) as { users: User[] };
      if (!Array.isArray(data.users)) return;
      this.mutate((db) => {
        for (const user of data.users) {
          const idx = db.users.findIndex((u) => u.id === user.id);
          if (idx >= 0) db.users[idx] = user;
          else db.users.push(user);
        }
      });
    } catch {
      /* 디렉터리 로드 실패는 조용히 넘긴다 — 운영(404)이거나 네트워크 문제 */
    }
  }

  // ── 읽기 ──────────────────────────────────────────────────────────────
  snapshot(): Db {
    return this.db;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeSessionExpired(listener: () => void): () => void {
    this.sessionListeners.add(listener);
    if (this.sessionExpired) queueMicrotask(listener);
    return () => this.sessionListeners.delete(listener);
  }

  // ── 인증 (인터페이스 밖, StoreProvider 가 세션을 세우려고 호출) ────────────
  /** 기존 사용자로 서버 세션을 연다. 성공 시 사용자, 실패 시 null. */
  async signInExisting(userId: UserId): Promise<User | null> {
    try {
      const res = await this.fetchImpl(`${this.base}/api/auth/session`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (res.status === 401) this.expireSession();
      if (!res.ok) return null;
      const data = (await res.json()) as { user: User };
      this.restoreSession();
      this.upsertUser(data.user);
      void this.refresh();
      return data.user;
    } catch {
      return null;
    }
  }

  /** 현재 세션 사용자. 새로고침 후 me 를 복원하는 데 쓴다. */
  async currentUser(): Promise<User | null> {
    try {
      const res = await this.fetchImpl(`${this.base}/api/auth/me`, {
        method: 'GET',
        credentials: 'include',
      });
      if (res.status === 401) this.expireSession();
      if (!res.ok) return null;
      const data = (await res.json()) as { user: User };
      this.restoreSession();
      this.upsertUser(data.user);
      return data.user;
    } catch {
      return null;
    }
  }

  async signOutSession(): Promise<void> {
    try {
      await this.fetchImpl(`${this.base}/api/auth/session`, {
        method: 'DELETE',
        credentials: 'include',
      });
    } finally {
      this.expireSession();
    }
  }

  // ── 쓰기 ──────────────────────────────────────────────────────────────
  async createUser(name: string, statusMessage = ''): Promise<User> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('이름이 비어 있습니다.');

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/api/auth/session`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed, statusMessage: statusMessage.trim() }),
      });
    } catch {
      throw new Error('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }

    if (res.status === 401) this.expireSession();
    const data = (await res.json().catch(() => ({}))) as { user?: User; error?: string };
    if (!res.ok || !data.user) {
      throw new Error(data.error ?? '사용자를 만들지 못했습니다.');
    }

    this.restoreSession();
    this.upsertUser(data.user);
    await this.refresh();
    return data.user;
  }

  async addFriendByCode(ownerId: UserId, code: string): Promise<AddFriendResult> {
    const typed = normalizeCode(code);
    if (!typed) return { ok: false, reason: '친구 코드를 입력해 주세요.' };
    const me = this.db.users.find((u) => u.id === ownerId);
    if (!me) return { ok: false, reason: '로그인 정보를 찾을 수 없습니다.' };
    if (normalizeCode(me.code) === typed) {
      return { ok: false, reason: '내 코드입니다. 상대의 코드를 받아 입력해 주세요.' };
    }

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/api/friends`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
    } catch {
      return { ok: false, reason: '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
    }

    if (res.status === 401) this.expireSession();
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      friend?: User;
      reason?: string;
      error?: string;
    };
    if (!res.ok || data.ok !== true || !data.friend) {
      return { ok: false, reason: data.reason ?? data.error ?? '친구를 추가하지 못했습니다.' };
    }

    this.mutate((db) => {
      const userIndex = db.users.findIndex((u) => u.id === data.friend!.id);
      if (userIndex >= 0) db.users[userIndex] = data.friend!;
      else db.users.push(data.friend!);
      if (!db.friendships.some((f) => f.ownerId === ownerId && f.friendId === data.friend!.id)) {
        db.friendships.push({
          ownerId,
          friendId: data.friend!.id,
          createdAt: Date.now(),
          favorite: false,
        });
      }
    });
    await this.refresh();
    return { ok: true, friend: data.friend };
  }

  toggleFavorite(ownerId: UserId, friendId: UserId): void {
    let changed = false;
    this.mutate((db) => {
      const f = db.friendships.find((x) => x.ownerId === ownerId && x.friendId === friendId);
      if (f) {
        f.favorite = !f.favorite;
        changed = true;
      }
    });
    if (!changed) return;
    void this.command(`/api/friends/${encodeURIComponent(friendId)}/favorite`, {});
  }

  removeFriend(ownerId: UserId, friendId: UserId): void {
    let removed: { favorite: boolean; createdAt: number } | null = null;
    this.mutate((db) => {
      const f = db.friendships.find((x) => x.ownerId === ownerId && x.friendId === friendId);
      if (f) removed = { favorite: f.favorite, createdAt: f.createdAt };
      db.friendships = db.friendships.filter(
        (x) => !(x.ownerId === ownerId && x.friendId === friendId),
      );
    });
    if (!removed) return;
    const snapshot = removed as { favorite: boolean; createdAt: number };
    void this.request('DELETE', `/api/friends/${encodeURIComponent(friendId)}`, undefined, () => {
      // 실패하면 되살린다.
      this.mutate((db) => {
        if (!db.friendships.some((x) => x.ownerId === ownerId && x.friendId === friendId)) {
          db.friendships.push({ ownerId, friendId, ...snapshot });
        }
      });
    });
  }

  openDirectChat(a: UserId, b: UserId): ChatId {
    const existing = directChatBetween(this.db, a, b);
    if (existing) return existing.id;

    const tempId = newId();
    this.mutate((db) => {
      if (directChatBetween(db, a, b)) return;
      db.chats.push({ id: tempId, memberIds: [a, b], createdAt: Date.now() });
    });

    const ready = (async (): Promise<ChatId | null> => {
      try {
        const res = await this.fetchImpl(`${this.base}/api/chats/direct`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetId: b }),
        });
        if (res.status === 401) this.expireSession();
        const data = (await res.json().catch(() => ({}))) as { chatId?: ChatId };
        if (!res.ok || !data.chatId) return null;
        this.chatIdAliases.set(tempId, data.chatId);
        await this.refresh();
        return data.chatId;
      } catch {
        return null;
      }
    })();
    this.chatReady.set(tempId, ready);
    void ready.finally(() => this.chatReady.delete(tempId));

    return directChatBetween(this.db, a, b)?.id ?? tempId;
  }

  /** 미러의 (임시일 수 있는) 방 id 를 서버가 아는 방 id 로 번역한다. */
  private toServerChatId(id: ChatId): ChatId {
    return this.chatIdAliases.get(id) ?? id;
  }

  async sendMessage(chatId: ChatId, senderId: UserId, text: string): Promise<SendMessageResult> {
    const body = text.trim();
    if (!body) return { ok: false, reason: '메시지를 입력해 주세요.' };
    const chat = this.db.chats.find((c) => c.id === chatId);
    if (!chat || !chat.memberIds.includes(senderId)) {
      return { ok: false, reason: '대화방을 찾을 수 없거나 메시지를 보낼 권한이 없습니다.' };
    }

    const pendingChat = this.chatReady.get(chatId);
    const serverChatId = pendingChat ? await pendingChat : this.toServerChatId(chatId);
    if (!serverChatId) {
      return { ok: false, reason: '대화방을 열지 못했습니다. 네트워크를 확인해 주세요.' };
    }

    try {
      const res = await this.fetchImpl(
        `${this.base}/api/chats/${encodeURIComponent(serverChatId)}/messages`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: body, clientKey: newId() }),
        },
      );
      if (res.status === 401) this.expireSession();
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        error?: string;
      };
      if (!res.ok || data.ok !== true) {
        return {
          ok: false,
          reason: data.reason ?? data.error ?? '메시지를 보내지 못했습니다. 다시 시도해 주세요.',
        };
      }
      await this.refresh();
      return { ok: true };
    } catch {
      return { ok: false, reason: '서버에 연결하지 못했습니다. 메시지는 전송되지 않았습니다.' };
    }
  }

  markRead(chatId: ChatId, userId: UserId): void {
    // 읽을 것이 없으면 아무것도 하지 않는다(무한 루프 방지, LocalRepository 와 동일).
    if (unreadCount(this.db, chatId, userId) === 0) return;
    this.mutate((db) => upsertRead(db, chatId, userId, Date.now()));
    void this.command(`/api/chats/${encodeURIComponent(this.toServerChatId(chatId))}/read`, {});
  }

  // ── 선물 ──────────────────────────────────────────────────────────────
  sendGift(input: SendGiftInput): SendGiftResult {
    const { senderId, receiverId, productId, message } = input;
    // 낙관적 검증: LocalRepository 와 같은 문구.
    if (senderId === receiverId) {
      return { ok: false, reason: '자기 자신에게는 선물할 수 없습니다.' };
    }
    const product = productById(productId);
    if (!product) return { ok: false, reason: '상품을 찾을 수 없습니다.' };
    if (!this.db.users.some((u) => u.id === senderId)) {
      return { ok: false, reason: '로그인 정보를 찾을 수 없습니다.' };
    }
    if (!this.db.users.some((u) => u.id === receiverId)) {
      return { ok: false, reason: '받는 사람을 찾을 수 없습니다.' };
    }

    // 선물은 대화 위에서 전달된다. 방이 없으면 여기서 생긴다.
    const chatId = this.openDirectChat(senderId, receiverId);
    const orderId = newId();
    const now = Date.now();
    this.mutate((db) => {
      db.giftOrders.push(
        newGiftOrder({
          id: orderId,
          productId,
          senderId,
          receiverId,
          chatId,
          message: message.trim(),
          price: product.price,
          at: now,
        }),
      );
      db.messages.push({
        id: newId(),
        chatId,
        senderId,
        kind: 'gift',
        giftOrderId: orderId,
        text: `[선물] ${product.brand} ${product.name}`,
        createdAt: now,
      });
      upsertRead(db, chatId, senderId, now);
    });

    void this.command(
      '/api/gifts',
      { receiverId, productId, message, clientKey: orderId },
      () => {
        // 서버 거절 시 낙관적 주문·메시지를 되돌린다.
        this.mutate((db) => {
          db.giftOrders = db.giftOrders.filter((o) => o.id !== orderId);
          db.messages = db.messages.filter((m) => m.giftOrderId !== orderId);
        });
      },
    );

    return { ok: true, orderId, chatId };
  }

  giftAction(orderId: string, actorId: UserId, action: GiftAction): GiftCommandResult {
    // FORCE_EXPIRE 는 운영 API 에 없다. 로컬에서도 막는다.
    if (action === 'FORCE_EXPIRE') {
      return { ok: false, reason: '허용되지 않은 동작입니다.' };
    }
    const index = this.db.giftOrders.findIndex((o) => o.id === orderId);
    const current = index < 0 ? undefined : this.db.giftOrders[index];
    if (!current) return { ok: false, reason: '선물을 찾을 수 없습니다.' };

    const now = Date.now();
    // 낙관적 검증·전이: 도메인 규칙을 그대로 재사용한다.
    const refusal = checkGiftAction(current, action, actorId, now);
    if (refusal) return { ok: false, reason: refusal };
    const applied = applyGiftAction(current, action, actorId, now);
    if (!applied.ok) return { ok: false, reason: applied.reason };

    const before = current;
    this.mutate((db) => {
      const i = db.giftOrders.findIndex((o) => o.id === orderId);
      if (i >= 0) db.giftOrders[i] = applied.order;
    });

    void this.command(
      `/api/gifts/${encodeURIComponent(orderId)}/actions`,
      { action },
      () => {
        // 서버 거절 시 이전 상태로 되돌린다.
        this.mutate((db) => {
          const i = db.giftOrders.findIndex((o) => o.id === orderId);
          if (i >= 0) db.giftOrders[i] = before;
        });
      },
    );

    return { ok: true, text: applied.text };
  }

  reset(): void {
    // 운영 구현에는 reset 이 없다. 인터페이스를 채우되 파괴적 서버 호출은 하지 않는다.
    throw new Error('ApiRepository 는 reset 을 지원하지 않습니다. (운영 API 에 reset 없음)');
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* 무시 */
      }
      this.ws = null;
    }
    this.listeners.clear();
    this.sessionListeners.clear();
    this.chatReady.clear();
  }

  // ── 내부 ──────────────────────────────────────────────────────────────

  /** 서버 스냅샷을 받아 미러를 통째로 교체한다. 내용이 바뀔 때만 알린다. */
  async hydrate(): Promise<void> {
    try {
      const res = await this.fetchImpl(`${this.base}/api/snapshot`, {
        method: 'GET',
        credentials: 'include',
      });
      if (res.status === 401) {
        this.expireSession();
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { db: Db };
      this.replace({ ...emptyDb(), ...data.db });
    } catch {
      /* 하이드레이트 실패는 조용히 넘긴다 — 재연결/다음 변경 신호에서 다시 시도한다 */
    }
  }

  /** 변경 신호를 받았을 때 스냅샷을 다시 받는다. 순서를 지키려고 체인에 매단다. */
  private refresh(): Promise<void> {
    this.refreshChain = this.refreshChain.then(() => this.hydrate());
    return this.refreshChain;
  }

  private connect(): void {
    if (this.disposed || this.sessionExpired || this.makeWs === false) return;
    const wsUrl = `${toWsUrl(this.base)}/ws`;
    let ws: WebSocketLike;
    try {
      ws = this.makeWs(wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.addEventListener('message', (ev: { data: unknown }) => {
      const parsed = parseSignal(ev.data);
      if (parsed?.type === 'change') void this.refresh();
    });
    ws.addEventListener('close', () => {
      if (this.ws === ws) this.ws = null;
      this.scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      /* close 가 뒤따르므로 여기서 재연결하지 않는다 */
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.sessionExpired || this.makeWs === false) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // 재연결 시 놓친 변경을 따라잡으려고 스냅샷도 다시 받는다.
      void this.refresh();
      this.connect();
    }, 1500);
  }

  private expireSession(): void {
    if (this.sessionExpired) return;
    this.sessionExpired = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const current = this.ws;
    this.ws = null;
    try {
      current?.close();
    } catch {
      /* 이미 닫힌 소켓 */
    }
    this.replace(emptyDb());
    void this.loadDirectory();
    this.sessionListeners.forEach((listener) => listener());
  }

  private restoreSession(): void {
    if (!this.sessionExpired) return;
    this.sessionExpired = false;
    this.connect();
  }

  private upsertUser(user: User): void {
    this.mutate((db) => {
      const idx = db.users.findIndex((u) => u.id === user.id);
      if (idx >= 0) db.users[idx] = user;
      else db.users.push(user);
    });
  }

  /**
   * 미러를 바꾸고, 직렬화 결과가 실제로 달라졌을 때만 알린다.
   * (LocalRepository 의 no-emit-on-no-change 규율과 같다 → React #185 방지)
   */
  private mutate(fn: (db: Db) => void): void {
    const next: Db = structuredClone(this.db);
    fn(next);
    this.commit(next);
  }

  private replace(next: Db): void {
    // 서버 스냅샷은 방을 서버 id 로 들고 온다. 낙관적으로 연 방에 임시 id 를 돌려줬다면,
    // 그 서버 id 를 임시 id 로 되접어 미러를 하나의 안정된 id 로 유지한다(유령 방 방지).
    if (this.chatIdAliases.size > 0) {
      const serverToTemp = new Map<ChatId, ChatId>();
      for (const [temp, server] of this.chatIdAliases) serverToTemp.set(server, temp);
      const remap = (id: ChatId): ChatId => serverToTemp.get(id) ?? id;
      for (const c of next.chats) c.id = remap(c.id);
      for (const m of next.messages) m.chatId = remap(m.chatId);
      for (const r of next.reads) r.chatId = remap(r.chatId);
      for (const o of next.giftOrders) o.chatId = remap(o.chatId);
    }
    this.commit(next);
  }

  private commit(next: Db): void {
    const after = JSON.stringify(next);
    if (after === this.serialized) {
      // 내용이 같으면 참조도 유지한다(같은 참조 계약).
      return;
    }
    this.db = next;
    this.serialized = after;
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }

  /** JSON 바디 POST. 실패(비-2xx 또는 {ok:false})면 onReject 를 부른다. */
  private command(
    path: string,
    body: unknown,
    onReject?: () => void,
    onOk?: (data: unknown) => void,
  ): Promise<void> {
    return this.request('POST', path, body, onReject, onOk);
  }

  private async request(
    method: string,
    path: string,
    body: unknown,
    onReject?: () => void,
    onOk?: (data: unknown) => void,
  ): Promise<void> {
    try {
      const res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        credentials: 'include',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let data: unknown = undefined;
      try {
        data = await res.json();
      } catch {
        /* 바디 없음 */
      }
      if (res.status === 401) this.expireSession();
      const rejected =
        !res.ok || (data !== null && typeof data === 'object' && (data as { ok?: boolean }).ok === false);
      if (rejected) {
        onReject?.();
      } else {
        onOk?.(data);
      }
    } catch {
      // 네트워크 오류: 낙관적 변경을 되돌린다.
      onReject?.();
    }
  }
}

const upsertRead = (db: Db, chatId: ChatId, userId: UserId, at: number): void => {
  const found = db.reads.find((r) => r.chatId === chatId && r.userId === userId);
  if (found) found.lastReadAt = Math.max(found.lastReadAt, at);
  else db.reads.push({ chatId, userId, lastReadAt: at });
};

const toWsUrl = (httpBase: string): string =>
  httpBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');

const parseSignal = (data: unknown): { type: string; scope?: string } | null => {
  if (typeof data !== 'string') return null;
  try {
    const parsed = JSON.parse(data) as { type?: string; scope?: string };
    return typeof parsed.type === 'string' ? { type: parsed.type, scope: parsed.scope } : null;
  } catch {
    return null;
  }
};
