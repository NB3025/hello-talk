import { hueFor, newFriendCode, newId } from '../domain/ids';
import { applyGiftAction, newGiftOrder, type GiftAction } from '../domain/gift';
import { productById } from '../domain/products';
import {
  directChatBetween,
  findUserByCode,
  isFriend,
  normalizeCode,
  unreadCount,
} from '../domain/selectors';
import { emptyDb, type ChatId, type Db, type User, type UserId } from '../domain/types';
import type {
  AddFriendResult,
  GiftCommandResult,
  Repository,
  SendGiftInput,
  SendGiftResult,
  SendMessageResult,
} from './repository';
import { seedUsers } from './seed';

const DB_KEY = 'hello-talk/db/v1';
const CHANNEL = 'hello-talk/sync';

/** 테스트에서 갈아끼울 수 있도록 필요한 만큼만 좁게 잡은 저장소 형태. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface Broadcaster {
  post(): void;
  close(): void;
}

const noopBroadcaster: Broadcaster = { post: () => {}, close: () => {} };

/**
 * 한 브라우저 안에서 여러 탭이 같은 세계를 공유한다.
 * - localStorage: 세계 (모든 사람, 모든 대화)
 * - sessionStorage: 내가 누구인지 (탭마다 다르다 → 탭 두 개 = 두 사람)
 * - BroadcastChannel: 상대가 보낸 메시지를 폴링 없이 받는 경로
 *
 * 한계: 읽고-고쳐-쓰기라서 두 탭이 같은 순간에 쓰면 한쪽이 덮일 수 있다.
 * 쓰기 직전에 저장소를 다시 읽어 창을 좁혔지만 완전히 없애지는 못했다.
 * 서버(또는 단일 쓰기 잠금)가 붙으면 사라지는 문제라 지금은 감수한다.
 */
export class LocalRepository implements Repository {
  private db: Db;
  /** 구독자가 현재 보고 있는 내용. 알림을 낼지 판단하는 기준. */
  private serialized: string;
  private listeners = new Set<() => void>();
  private broadcaster: Broadcaster;
  private detach: (() => void)[] = [];

  constructor(
    private store: KeyValueStore,
    options: { broadcast?: boolean } = {},
  ) {
    this.db = this.load();
    this.serialized = JSON.stringify(this.db);
    this.broadcaster = options.broadcast === false ? noopBroadcaster : this.makeBroadcaster();
  }

  // ── 읽기 ──────────────────────────────────────────────────────────────
  snapshot(): Db {
    return this.db;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── 쓰기 ──────────────────────────────────────────────────────────────
  createUser(name: string, statusMessage = ''): User {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('이름이 비어 있습니다.');
    let created!: User;
    this.write((db) => {
      const used = new Set(db.users.map((u) => normalizeCode(u.code)));
      let code = newFriendCode();
      while (used.has(normalizeCode(code))) code = newFriendCode();
      created = {
        id: newId(),
        code,
        name: trimmed,
        statusMessage: statusMessage.trim(),
        hue: hueFor(trimmed + code),
        createdAt: Date.now(),
      };
      db.users.push(created);
    });
    return created;
  }

  addFriendByCode(ownerId: UserId, code: string): AddFriendResult {
    const typed = normalizeCode(code);
    if (!typed) return { ok: false, reason: '친구 코드를 입력해 주세요.' };

    const db = this.db;
    const me = db.users.find((u) => u.id === ownerId);
    if (!me) return { ok: false, reason: '로그인 정보를 찾을 수 없습니다.' };
    if (normalizeCode(me.code) === typed) {
      return { ok: false, reason: '내 코드입니다. 상대의 코드를 받아 입력해 주세요.' };
    }

    const found = findUserByCode(db, code);
    if (!found) return { ok: false, reason: `${formatCode(typed)} 코드를 쓰는 사람이 없습니다.` };
    if (isFriend(db, ownerId, found.id)) {
      return { ok: false, reason: `${found.name} 님은 이미 친구입니다.` };
    }

    this.write((next) => {
      next.friendships.push({
        ownerId,
        friendId: found.id,
        createdAt: Date.now(),
        favorite: false,
      });
    });
    return { ok: true, friend: found };
  }

  toggleFavorite(ownerId: UserId, friendId: UserId): void {
    this.write((db) => {
      const f = db.friendships.find((x) => x.ownerId === ownerId && x.friendId === friendId);
      if (f) f.favorite = !f.favorite;
    });
  }

  removeFriend(ownerId: UserId, friendId: UserId): void {
    this.write((db) => {
      db.friendships = db.friendships.filter(
        (f) => !(f.ownerId === ownerId && f.friendId === friendId),
      );
    });
  }

  openDirectChat(a: UserId, b: UserId): ChatId {
    const existing = directChatBetween(this.db, a, b);
    if (existing) return existing.id;

    const id = newId();
    this.write((db) => {
      // 다시 읽은 뒤 한 번 더 확인한다 — 다른 탭이 방금 같은 방을 만들었을 수 있다.
      const again = directChatBetween(db, a, b);
      if (again) return;
      db.chats.push({ id, memberIds: [a, b], createdAt: Date.now() });
    });
    return directChatBetween(this.db, a, b)?.id ?? id;
  }

  sendMessage(chatId: ChatId, senderId: UserId, text: string): SendMessageResult {
    const body = text.trim();
    if (!body) return { ok: false, reason: '메시지를 입력해 주세요.' };
    let sent = false;
    this.write((db) => {
      const chat = db.chats.find((c) => c.id === chatId);
      if (!chat || !chat.memberIds.includes(senderId)) return;
      const now = Date.now();
      db.messages.push({ id: newId(), chatId, senderId, text: body, createdAt: now });
      upsertRead(db, chatId, senderId, now);
      sent = true;
    });
    return sent
      ? { ok: true }
      : { ok: false, reason: '대화방을 찾을 수 없거나 메시지를 보낼 권한이 없습니다.' };
  }

  markRead(chatId: ChatId, userId: UserId): void {
    // 읽을 것이 없으면 아무것도 하지 않는다. 무조건 쓰면 emit 이 나가고,
    // 그 emit 을 보고 다시 markRead 하는 화면과 만나 무한 루프가 된다.
    if (unreadCount(this.db, chatId, userId) === 0) return;
    this.write((db) => upsertRead(db, chatId, userId, Date.now()));
  }

  // ── 선물 ──────────────────────────────────────────────────────────────
  sendGift(input: SendGiftInput): SendGiftResult {
    const { senderId, receiverId, productId, message } = input;
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

    this.write((db) => {
      const now = Date.now();
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
        // 선물 버블을 못 그리는 화면(검색·미리보기)에서도 뜻이 통하게 텍스트를 채운다.
        text: `[선물] ${product.brand} ${product.name}`,
        createdAt: now,
      });
      upsertRead(db, chatId, senderId, now);
    });

    return { ok: true, orderId, chatId };
  }

  giftAction(orderId: string, actorId: UserId, action: GiftAction): GiftCommandResult {
    let result: GiftCommandResult = { ok: false, reason: '선물을 찾을 수 없습니다.' };
    this.write((db) => {
      // 다시 읽은 db 에서 찾는다 — 다른 탭이 방금 상태를 바꿨을 수 있다.
      const index = db.giftOrders.findIndex((o) => o.id === orderId);
      const current = index < 0 ? undefined : db.giftOrders[index];
      if (!current) return;

      const applied = applyGiftAction(current, action, actorId, Date.now());
      if (!applied.ok) {
        // 내용을 바꾸지 않고 나간다. write 가 알림을 내지 않으므로 화면도 흔들리지 않는다.
        result = { ok: false, reason: applied.reason };
        return;
      }
      db.giftOrders[index] = applied.order;
      result = { ok: true, text: applied.text };
    });
    return result;
  }

  reset(): void {
    this.write((db) => {
      const fresh = seedDb();
      db.users = fresh.users;
      db.friendships = fresh.friendships;
      db.chats = fresh.chats;
      db.messages = fresh.messages;
      db.reads = fresh.reads;
      db.giftOrders = fresh.giftOrders;
    });
  }

  dispose(): void {
    this.detach.forEach((off) => off());
    this.detach = [];
    this.broadcaster.close();
    this.listeners.clear();
  }

  // ── 내부 ──────────────────────────────────────────────────────────────
  private load(): Db {
    const raw = this.store.getItem(DB_KEY);
    if (!raw) {
      const fresh = seedDb();
      this.store.setItem(DB_KEY, JSON.stringify(fresh));
      return fresh;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<Db>;
      return { ...emptyDb(), ...parsed };
    } catch {
      // 저장된 값이 깨졌다면 데모 데이터로 되돌린다. 여기서 던지면 앱이 아예 안 뜬다.
      const fresh = seedDb();
      this.store.setItem(DB_KEY, JSON.stringify(fresh));
      return fresh;
    }
  }

  /**
   * 쓰기 직전에 저장소를 다시 읽어, 다른 탭의 변경을 덮어쓸 창을 좁힌다.
   *
   * 두 가지를 분리해서 다룬다:
   *  - 스냅샷 채택은 항상 한다. 조기 반환으로 건너뛰면 다른 탭이 만든 방을
   *    못 보고 존재하지 않는 id 를 돌려주는 일이 생긴다.
   *  - 알림은 구독자가 보는 내용이 실제로 달라졌을 때만 낸다. 내용이 같은데도
   *    알리면 화면이 다시 그려지고, 그 화면이 또 쓰면 무한 루프가 된다.
   */
  private write(mutate: (db: Db) => void): void {
    const seenByUi = this.serialized;
    const fresh = this.load();
    mutate(fresh);

    const after = JSON.stringify(fresh);
    this.store.setItem(DB_KEY, after);
    this.db = fresh;
    this.serialized = after;

    if (after !== seenByUi) {
      this.emit();
      this.broadcaster.post();
    }
  }

  /** 다른 탭이 바꿨다는 신호를 받았을 때. 내용이 같으면 아무 일도 하지 않는다. */
  private pull(): void {
    const fresh = this.load();
    const after = JSON.stringify(fresh);
    if (after === this.serialized) return;
    this.db = fresh;
    this.serialized = after;
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }

  private makeBroadcaster(): Broadcaster {
    // storage 이벤트는 '다른' 탭에서만 발생하므로 BroadcastChannel 이 없는 환경의 대체 경로가 된다.
    if (typeof window !== 'undefined') {
      const onStorage = (e: StorageEvent) => {
        if (e.key === null || e.key === DB_KEY) this.pull();
      };
      window.addEventListener('storage', onStorage);
      this.detach.push(() => window.removeEventListener('storage', onStorage));
    }

    if (typeof BroadcastChannel === 'undefined') return noopBroadcaster;
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = () => this.pull();
    return {
      post: () => ch.postMessage('changed'),
      close: () => ch.close(),
    };
  }
}

const upsertRead = (db: Db, chatId: ChatId, userId: UserId, at: number): void => {
  const found = db.reads.find((r) => r.chatId === chatId && r.userId === userId);
  if (found) found.lastReadAt = Math.max(found.lastReadAt, at);
  else db.reads.push({ chatId, userId, lastReadAt: at });
};

const formatCode = (normalized: string): string =>
  normalized.startsWith('HT') ? `HT-${normalized.slice(2)}` : normalized;

const seedDb = (): Db => ({ ...emptyDb(), users: seedUsers() });
