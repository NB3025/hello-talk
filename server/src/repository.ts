import { hueFor, newFriendCode, newId } from '../../src/domain/ids';
import { applyGiftAction, newGiftOrder, type GiftAction } from '../../src/domain/gift';
import { productById } from '../../src/domain/products';
import {
  findUserByCode,
  isFriend,
  normalizeCode,
  unreadCount,
} from '../../src/domain/selectors';
import { emptyDb, type ChatId, type Db, type User, type UserId } from '../../src/domain/types';
import type { Pool, PoolClient } from './db/pool';
import { toChat, toFriendship, toGiftOrder, toMessage, toRead, toUser } from './db/rows';

/**
 * 서버 저장소. localRepository 와 같은 의미(검증 문구·멱등성·선물 규칙 재사용)를
 * Postgres 트랜잭션 위에서 다시 만든다.
 *
 * 핵심 원칙:
 *  - 규칙은 도메인 코드(selectors, applyGiftAction)에서만 온다. 여기서 다시 쓰지 않는다.
 *  - 각 뮤테이터는 트랜잭션 안에서 현재 db 스냅샷을 읽어 도메인 셀렉터로 판단한 뒤 쓴다.
 *  - 실제 내용이 바뀐 명령만 changed=true 를 돌려준다 → WebSocket 브로드캐스트 판단 근거.
 */

export type AddFriendResult =
  | { ok: true; friend: User }
  | { ok: false; reason: string };

export type SendGiftResult =
  | { ok: true; orderId: string; chatId: ChatId }
  | { ok: false; reason: string };

export type GiftCommandResult = { ok: true; text: string } | { ok: false; reason: string };

/** 뮤테이터 공통 반환: 결과 + 실제 상태가 변했는지(브로드캐스트 여부). */
export interface Mutation<T> {
  result: T;
  changed: boolean;
}

/** 1:1 방의 정규화된 쌍 키. 순서 무관하게 같은 두 사람이면 같은 값. */
const directPairKey = (a: UserId, b: UserId): string => [a, b].sort().join('::');

export class ServerRepository {
  constructor(private pool: Pool) {}

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ── 읽기 ──────────────────────────────────────────────────────────────

  /** 전역 스냅샷. 프런트엔드 미러가 그대로 하이드레이트한다. */
  async snapshot(client?: PoolClient): Promise<Db> {
    const q = client ?? this.pool;
    const db = emptyDb();
    const [users, friendships, chats, messages, reads, gifts] = await Promise.all([
      q.query('SELECT * FROM users ORDER BY created_at'),
      q.query('SELECT * FROM friendships'),
      q.query(
        `SELECT c.*, COALESCE(
           (SELECT array_agg(cm.user_id) FROM chat_members cm WHERE cm.chat_id = c.id),
           ARRAY[]::text[]
         ) AS member_ids
         FROM chats c`,
      ),
      q.query('SELECT * FROM messages'),
      q.query('SELECT * FROM reads'),
      q.query('SELECT * FROM gift_orders'),
    ]);
    db.users = users.rows.map(toUser);
    db.friendships = friendships.rows.map(toFriendship);
    db.chats = chats.rows.map(toChat);
    db.messages = messages.rows.map(toMessage);
    db.reads = reads.rows.map(toRead);
    db.giftOrders = gifts.rows.map(toGiftOrder);
    return db;
  }

  async userById(id: UserId): Promise<User | undefined> {
    const r = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return r.rows[0] ? toUser(r.rows[0]) : undefined;
  }

  /** 모든 사용자(데모 로그인 화면의 사용자 디렉터리 전용). dev 에서만 노출한다. */
  async allUsers(): Promise<User[]> {
    const r = await this.pool.query('SELECT * FROM users ORDER BY created_at');
    return r.rows.map(toUser);
  }

  /**
   * 행위자 자신의 세계로 좁힌 스냅샷. 프런트엔드 미러가 그대로 하이드레이트한다.
   * 포함 범위:
   *  - 방: 행위자가 멤버인 방들.
   *  - 메시지·읽음: 그 방들의 것.
   *  - 친구관계: 행위자가 owner 이거나 friend 인 행(단방향 표시를 상대도 볼 수 있어야 하므로 양쪽).
   *  - 선물: 행위자가 sender 이거나 receiver 인 주문.
   *  - 사용자: 행위자 본인 + 위에서 등장한 모든 상대(친구/대화 상대/선물 당사자).
   * 남의 방·메시지·선물 원장은 절대 포함되지 않는다.
   */
  async scopedSnapshot(actorId: UserId, client?: PoolClient): Promise<Db> {
    const q = client ?? this.pool;
    const db = emptyDb();

    const [chats, friendships, gifts] = await Promise.all([
      q.query(
        `SELECT c.*, COALESCE(
           (SELECT array_agg(cm2.user_id) FROM chat_members cm2 WHERE cm2.chat_id = c.id),
           ARRAY[]::text[]
         ) AS member_ids
         FROM chats c
         WHERE EXISTS (SELECT 1 FROM chat_members cm WHERE cm.chat_id = c.id AND cm.user_id = $1)`,
        [actorId],
      ),
      q.query(
        'SELECT * FROM friendships WHERE owner_id = $1 OR friend_id = $1',
        [actorId],
      ),
      q.query(
        'SELECT * FROM gift_orders WHERE sender_id = $1 OR receiver_id = $1',
        [actorId],
      ),
    ]);

    db.chats = chats.rows.map(toChat);
    db.friendships = friendships.rows.map(toFriendship);
    db.giftOrders = gifts.rows.map(toGiftOrder);

    const chatIds = db.chats.map((c) => c.id);
    // 빈 배열이어도 ANY(ARRAY[]) 는 아무 행도 매칭하지 않으므로 그대로 질의한다.
    const [messages, reads] = await Promise.all([
      q.query('SELECT * FROM messages WHERE chat_id = ANY($1::text[])', [chatIds]),
      q.query('SELECT * FROM reads WHERE chat_id = ANY($1::text[])', [chatIds]),
    ]);
    db.messages = messages.rows.map(toMessage);
    db.reads = reads.rows.map(toRead);

    // 등장하는 모든 사용자 id 를 모아 본인 것까지 한 번에 읽는다.
    const userIds = new Set<string>([actorId]);
    for (const c of db.chats) for (const m of c.memberIds) userIds.add(m);
    for (const f of db.friendships) {
      userIds.add(f.ownerId);
      userIds.add(f.friendId);
    }
    for (const o of db.giftOrders) {
      userIds.add(o.senderId);
      userIds.add(o.receiverId);
    }
    const ids = [...userIds];
    const users = await q.query('SELECT * FROM users WHERE id = ANY($1::text[]) ORDER BY created_at', [ids]);
    db.users = users.rows.map(toUser);

    return db;
  }

  // ── 사용자/인증 ────────────────────────────────────────────────────────

  /** 새 사용자를 만든다. localRepository.createUser 와 같은 규칙. */
  async createUser(name: string, statusMessage = ''): Promise<User> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('이름이 비어 있습니다.');
    return this.tx(async (c) => {
      const existing = await c.query('SELECT code FROM users');
      const used = new Set(existing.rows.map((r) => normalizeCode(r.code)));
      let code = newFriendCode();
      while (used.has(normalizeCode(code))) code = newFriendCode();
      const user: User = {
        id: newId(),
        code,
        name: trimmed,
        statusMessage: statusMessage.trim(),
        hue: hueFor(trimmed + code),
        createdAt: Date.now(),
      };
      await c.query(
        `INSERT INTO users (id, code, name, status_message, hue, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [user.id, user.code, user.name, user.statusMessage, user.hue, user.createdAt],
      );
      return user;
    });
  }

  // ── 친구 ──────────────────────────────────────────────────────────────

  async addFriendByCode(ownerId: UserId, code: string): Promise<Mutation<AddFriendResult>> {
    const typed = normalizeCode(code);
    if (!typed) return { result: { ok: false, reason: '친구 코드를 입력해 주세요.' }, changed: false };

    return this.tx(async (c) => {
      const db = await this.snapshot(c);
      const me = db.users.find((u) => u.id === ownerId);
      if (!me) return { result: { ok: false, reason: '로그인 정보를 찾을 수 없습니다.' }, changed: false };
      if (normalizeCode(me.code) === typed) {
        return {
          result: { ok: false, reason: '내 코드입니다. 상대의 코드를 받아 입력해 주세요.' },
          changed: false,
        };
      }
      const found = findUserByCode(db, code);
      if (!found) {
        return {
          result: { ok: false, reason: `${formatCode(typed)} 코드를 쓰는 사람이 없습니다.` },
          changed: false,
        };
      }
      if (isFriend(db, ownerId, found.id)) {
        return { result: { ok: false, reason: `${found.name} 님은 이미 친구입니다.` }, changed: false };
      }
      await c.query(
        `INSERT INTO friendships (owner_id, friend_id, created_at, favorite)
         VALUES ($1,$2,$3,FALSE)`,
        [ownerId, found.id, Date.now()],
      );
      return { result: { ok: true, friend: found }, changed: true };
    });
  }

  async toggleFavorite(ownerId: UserId, friendId: UserId): Promise<Mutation<void>> {
    return this.tx(async (c) => {
      const r = await c.query(
        `UPDATE friendships SET favorite = NOT favorite
         WHERE owner_id = $1 AND friend_id = $2`,
        [ownerId, friendId],
      );
      return { result: undefined, changed: (r.rowCount ?? 0) > 0 };
    });
  }

  async removeFriend(ownerId: UserId, friendId: UserId): Promise<Mutation<void>> {
    return this.tx(async (c) => {
      const r = await c.query(
        'DELETE FROM friendships WHERE owner_id = $1 AND friend_id = $2',
        [ownerId, friendId],
      );
      return { result: undefined, changed: (r.rowCount ?? 0) > 0 };
    });
  }

  // ── 대화 ──────────────────────────────────────────────────────────────

  /**
   * 1:1 방을 연다. 있으면 그 방, 없으면 만든다(멱등).
   * direct_pair_key 유니크 인덱스로 동시 호출도 하나로 수렴한다 — 충돌 시 기존 방을 읽어 돌려준다.
   */
  async openDirectChat(a: UserId, b: UserId): Promise<Mutation<ChatId>> {
    return this.tx(async (c) => {
      const key = directPairKey(a, b);
      const existing = await c.query(
        'SELECT id FROM chats WHERE direct_pair_key = $1',
        [key],
      );
      if (existing.rows[0]) {
        return { result: existing.rows[0].id as ChatId, changed: false };
      }
      const id = newId();
      const now = Date.now();
      // 유니크 위반이면(다른 트랜잭션이 방금 만듦) 아무 것도 넣지 않는다.
      const inserted = await c.query(
        `INSERT INTO chats (id, title, created_at, direct_pair_key)
         VALUES ($1, NULL, $2, $3)
         ON CONFLICT (direct_pair_key) WHERE direct_pair_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [id, now, key],
      );
      if (inserted.rows[0]) {
        await c.query(
          `INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2),($1,$3)`,
          [id, a, b],
        );
        return { result: id as ChatId, changed: true };
      }
      const again = await c.query('SELECT id FROM chats WHERE direct_pair_key = $1', [key]);
      return { result: (again.rows[0]?.id ?? id) as ChatId, changed: false };
    });
  }

  async sendMessage(
    chatId: ChatId,
    senderId: UserId,
    text: string,
  ): Promise<Mutation<{ ok: boolean; messageId?: string }>> {
    const body = text.trim();
    if (!body) return { result: { ok: false }, changed: false };
    return this.tx(async (c) => {
      const member = await c.query(
        'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
        [chatId, senderId],
      );
      if (member.rowCount === 0) return { result: { ok: false }, changed: false };
      const now = Date.now();
      const messageId = newId();
      await c.query(
        `INSERT INTO messages (id, chat_id, sender_id, text, created_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [messageId, chatId, senderId, body, now],
      );
      await upsertRead(c, chatId, senderId, now);
      return { result: { ok: true, messageId }, changed: true };
    });
  }

  async markRead(chatId: ChatId, userId: UserId): Promise<Mutation<void>> {
    return this.tx(async (c) => {
      const db = await this.snapshot(c);
      // 읽을 것이 없으면 아무것도 하지 않는다 (no-op 은 브로드캐스트하지 않는다).
      if (unreadCount(db, chatId, userId) === 0) return { result: undefined, changed: false };
      await upsertRead(c, chatId, userId, Date.now());
      return { result: undefined, changed: true };
    });
  }

  // ── 선물 ──────────────────────────────────────────────────────────────

  async sendGift(input: {
    senderId: UserId;
    receiverId: UserId;
    productId: string;
    message: string;
  }): Promise<Mutation<SendGiftResult>> {
    const { senderId, receiverId, productId, message } = input;
    if (senderId === receiverId) {
      return { result: { ok: false, reason: '자기 자신에게는 선물할 수 없습니다.' }, changed: false };
    }
    const product = productById(productId);
    if (!product) return { result: { ok: false, reason: '상품을 찾을 수 없습니다.' }, changed: false };

    return this.tx(async (c) => {
      const senderExists = await c.query('SELECT 1 FROM users WHERE id = $1', [senderId]);
      if (senderExists.rowCount === 0) {
        return { result: { ok: false, reason: '로그인 정보를 찾을 수 없습니다.' }, changed: false };
      }
      const receiverExists = await c.query('SELECT 1 FROM users WHERE id = $1', [receiverId]);
      if (receiverExists.rowCount === 0) {
        return { result: { ok: false, reason: '받는 사람을 찾을 수 없습니다.' }, changed: false };
      }

      // 선물은 대화 위에서 전달된다. 방이 없으면 여기서 만든다(멱등).
      const chatId = await this.ensureDirectChat(c, senderId, receiverId);
      const orderId = newId();
      const now = Date.now();
      const order = newGiftOrder({
        id: orderId,
        productId,
        senderId,
        receiverId,
        chatId,
        message: message.trim(),
        price: product.price,
        at: now,
      });
      await insertGiftOrder(c, order);
      await c.query(
        `INSERT INTO messages (id, chat_id, sender_id, text, created_at, kind, gift_order_id)
         VALUES ($1,$2,$3,$4,$5,'gift',$6)`,
        [newId(), chatId, senderId, `[선물] ${product.brand} ${product.name}`, now, orderId],
      );
      await upsertRead(c, chatId, senderId, now);
      return { result: { ok: true, orderId, chatId }, changed: true };
    });
  }

  async giftAction(
    orderId: string,
    actorId: UserId,
    action: GiftAction,
  ): Promise<Mutation<GiftCommandResult>> {
    return this.tx(async (c) => {
      const r = await c.query('SELECT * FROM gift_orders WHERE id = $1 FOR UPDATE', [orderId]);
      if (!r.rows[0]) {
        return { result: { ok: false, reason: '선물을 찾을 수 없습니다.' }, changed: false };
      }
      const current = toGiftOrder(r.rows[0]);
      const applied = applyGiftAction(current, action, actorId, Date.now());
      if (!applied.ok) {
        // 상태를 바꾸지 않고 나간다 → 브로드캐스트도 없다.
        return { result: { ok: false, reason: applied.reason }, changed: false };
      }
      await updateGiftOrder(c, applied.order);
      return { result: { ok: true, text: applied.text }, changed: true };
    });
  }

  // ── 내부 헬퍼 ──────────────────────────────────────────────────────────

  /** 트랜잭션 안에서 1:1 방을 보장한다 (sendGift 용). */
  private async ensureDirectChat(c: PoolClient, a: UserId, b: UserId): Promise<ChatId> {
    const key = directPairKey(a, b);
    const existing = await c.query('SELECT id FROM chats WHERE direct_pair_key = $1', [key]);
    if (existing.rows[0]) return existing.rows[0].id as ChatId;
    const id = newId();
    const inserted = await c.query(
      `INSERT INTO chats (id, title, created_at, direct_pair_key)
       VALUES ($1, NULL, $2, $3)
       ON CONFLICT (direct_pair_key) WHERE direct_pair_key IS NOT NULL DO NOTHING
       RETURNING id`,
      [id, Date.now(), key],
    );
    if (inserted.rows[0]) {
      await c.query(`INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2),($1,$3)`, [id, a, b]);
      return id as ChatId;
    }
    const again = await c.query('SELECT id FROM chats WHERE direct_pair_key = $1', [key]);
    return (again.rows[0]?.id ?? id) as ChatId;
  }

  // ── 멱등성 ──────────────────────────────────────────────────────────────

  /**
   * 멱등 키가 있으면 저장된 결과를 그대로 돌려준다. 없으면 fn 을 돌리고 결과를 저장한다.
   * 메시지·선물·방 열기 재시도가 중복 생성하지 않게 한다.
   *
   * 동시성: 같은 (scope, actor, key) 로 재시도가 겹쳐도 부수효과가 두 번 나면 안 된다.
   * 그래서 이 (scope, actor, key) 에 대한 트랜잭션 스코프 advisory 락을 먼저 잡는다 —
   * 락을 잡은 트랜잭션이 커밋될 때까지 같은 키의 다른 요청은 여기서 대기한다. 락을 잡은 뒤
   * 저장된 결과가 이미 있으면 그것을 돌려주고(중복 실행 없음), 없으면 fn 을 실행하고 결과를
   * 저장한 다음 커밋한다. lookup·실행·저장이 하나의 트랜잭션 안에서 원자적으로 일어난다.
   *
   * 주의: fn(mutator) 은 내부에서 자체 트랜잭션을 연다. Postgres 는 같은 커넥션 안에서
   * 트랜잭션을 중첩하지 않으므로(자식 BEGIN/COMMIT 은 무시/경고), 여기서 잡은 advisory 락은
   * 이 커넥션(=게이트 트랜잭션)에 매여 있고, fn 의 커밋과 무관하게 게이트가 커밋될 때 풀린다.
   * 결과 저장까지 마친 뒤 게이트를 커밋하므로, 대기하던 재시도는 저장된 결과를 반드시 본다.
   */
  async withIdempotency<T>(
    scope: string,
    actorId: UserId,
    key: string | undefined,
    fn: () => Promise<Mutation<T>>,
  ): Promise<Mutation<T>> {
    if (!key) return fn();

    const gate = await this.pool.connect();
    try {
      await gate.query('BEGIN');
      // 이 (scope, actor, key) 에 대한 트랜잭션 스코프 락. 같은 키의 동시 재시도는 직렬화된다.
      const [k1, k2] = advisoryKey(scope, actorId, key);
      await gate.query('SELECT pg_advisory_xact_lock($1, $2)', [k1, k2]);

      // 락을 잡은 뒤에 조회한다 — 앞선 요청이 이미 저장했다면 그 결과를 그대로 돌려준다.
      const existing = await gate.query(
        'SELECT result FROM idempotency_keys WHERE scope = $1 AND actor_id = $2 AND key = $3',
        [scope, actorId, key],
      );
      if (existing.rows[0]) {
        await gate.query('COMMIT');
        return { result: existing.rows[0].result as T, changed: false };
      }

      // 아직 없다 — 이 요청이 실행한다. fn 은 자체 트랜잭션에서 부수효과를 커밋한다.
      const out = await fn();
      // 성공했을 때만 키를 남긴다. 실패(검증 거절)는 재시도 시 다시 평가받아야 한다.
      const okResult = out.result as unknown as { ok?: boolean };
      if (okResult.ok !== false) {
        await gate.query(
          `INSERT INTO idempotency_keys (scope, actor_id, key, result, created_at)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (scope, actor_id, key) DO NOTHING`,
          [scope, actorId, key, JSON.stringify(out.result), Date.now()],
        );
      }
      // 저장까지 마친 뒤 커밋 → 락 해제. 대기하던 재시도는 저장된 결과를 본다.
      await gate.query('COMMIT');
      return out;
    } catch (err) {
      await gate.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      gate.release();
    }
  }
}

const upsertRead = async (
  c: PoolClient,
  chatId: ChatId,
  userId: UserId,
  at: number,
): Promise<void> => {
  await c.query(
    `INSERT INTO reads (chat_id, user_id, last_read_at)
     VALUES ($1,$2,$3)
     ON CONFLICT (chat_id, user_id)
     DO UPDATE SET last_read_at = GREATEST(reads.last_read_at, EXCLUDED.last_read_at)`,
    [chatId, userId, at],
  );
};

const insertGiftOrder = async (c: PoolClient, o: import('../../src/domain/gift').GiftOrder): Promise<void> => {
  await c.query(
    `INSERT INTO gift_orders
       (id, product_id, sender_id, receiver_id, chat_id, message, price, status,
        paid_at, responded_at, expires_at, extensions_used, used_at, closed_by, refund_amount, ledger)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      o.id, o.productId, o.senderId, o.receiverId, o.chatId, o.message, o.price, o.status,
      o.paidAt, o.respondedAt ?? null, o.expiresAt ?? null, o.extensionsUsed,
      o.usedAt ?? null, o.closedBy ?? null, o.refundAmount ?? null, JSON.stringify(o.ledger),
    ],
  );
};

const updateGiftOrder = async (c: PoolClient, o: import('../../src/domain/gift').GiftOrder): Promise<void> => {
  await c.query(
    `UPDATE gift_orders SET
       status = $2, responded_at = $3, expires_at = $4, extensions_used = $5,
       used_at = $6, closed_by = $7, refund_amount = $8, ledger = $9
     WHERE id = $1`,
    [
      o.id, o.status, o.respondedAt ?? null, o.expiresAt ?? null, o.extensionsUsed,
      o.usedAt ?? null, o.closedBy ?? null, o.refundAmount ?? null, JSON.stringify(o.ledger),
    ],
  );
};

const formatCode = (normalized: string): string =>
  normalized.startsWith('HT') ? `HT-${normalized.slice(2)}` : normalized;

/** 문자열을 32비트 정수로 해시한다(FNV-1a). advisory 락 키 산출용. */
const hash32 = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // 부호 있는 32비트로 접어 넣는다(pg 의 int4 범위에 맞춘다).
  return h | 0;
};

/**
 * (scope, actor, key) 를 pg_advisory_xact_lock(int4, int4) 인자 두 개로 만든다.
 * 첫 인자는 scope, 둘째는 actor+key 해시 — 서로 다른 키가 같은 락으로 뭉치는 것을 줄인다.
 */
const advisoryKey = (scope: string, actorId: string, key: string): [number, number] => [
  hash32(`idem:${scope}`),
  hash32(`${actorId}\u0000${key}`),
];
