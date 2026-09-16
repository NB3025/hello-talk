import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyWebsocket from '@fastify/websocket';
import type { GiftAction } from '../../src/domain/gift';
import { seedUsers } from '../../src/store/seed';
import type { Pool } from './db/pool';
import { runMigrations } from './db/pool';
import { ServerRepository } from './repository';
import { RealtimeHub } from './realtime';

const SESSION_COOKIE = 'ht_session';

export interface AppDeps {
  pool: Pool;
  cookieSecret: string;
  /** dev 전용 seed/reset 엔드포인트를 열지 여부. 운영에서는 false. */
  devTools?: boolean;
}

/**
 * Fastify 인스턴스를 조립한다. 라우트를 여기 모아 두면 테스트가 실제 포트에 띄우지 않고도
 * `app.inject` 로 요청을 흉내낼 수 있다(HTTP), WebSocket 은 실제 listen 후 붙는다.
 *
 * 인증 모델: 세션 쿠키(서명·HttpOnly)에 담긴 userId 가 행위자 정체성의 유일한 근거다.
 * 어떤 명령도 요청 바디의 user/actor id 를 권한 판단에 쓰지 않는다.
 */
export const buildApp = (deps: AppDeps): FastifyInstance => {
  const app = Fastify({ logger: false });
  const repo = new ServerRepository(deps.pool);
  const hub = new RealtimeHub();

  void app.register(fastifyCookie, { secret: deps.cookieSecret });
  void app.register(fastifyWebsocket);

  /** 세션 쿠키를 읽어 행위자 userId 를 돌려준다. 없거나 위조면 null. */
  const sessionUserId = (req: FastifyRequest): string | null => {
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return null;
    const unsigned = req.unsignCookie(raw);
    return unsigned.valid && unsigned.value ? unsigned.value : null;
  };

  /** 세션이 유효하고 사용자가 존재하면 userId, 아니면 401 응답 후 null. */
  const requireUser = async (req: FastifyRequest, reply: FastifyReply): Promise<string | null> => {
    const uid = sessionUserId(req);
    if (!uid) {
      await reply.code(401).send({ error: '로그인이 필요합니다.' });
      return null;
    }
    const user = await repo.userById(uid);
    if (!user) {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      await reply.code(401).send({ error: '로그인이 필요합니다.' });
      return null;
    }
    return uid;
  };

  const setSession = (reply: FastifyReply, userId: string): void => {
    reply.setCookie(SESSION_COOKIE, userId, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  };

  // ── 헬스 ──────────────────────────────────────────────────────────────
  app.get('/health', async () => ({ status: 'ok' }));

  // ── 인증 ──────────────────────────────────────────────────────────────

  // 세션 생성: 새 사용자 만들기({name}) 또는 기존 데모 사용자로 로그인({userId}).
  app.post('/api/auth/session', async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string; statusMessage?: string; userId?: string };
    if (body.userId) {
      const user = await repo.userById(body.userId);
      if (!user) return reply.code(404).send({ error: '사용자를 찾을 수 없습니다.' });
      setSession(reply, user.id);
      return { user };
    }
    if (typeof body.name === 'string' && body.name.trim()) {
      const user = await repo.createUser(body.name, body.statusMessage ?? '');
      setSession(reply, user.id);
      return reply.code(201).send({ user });
    }
    return reply.code(400).send({ error: '이름 또는 사용자 id 가 필요합니다.' });
  });

  app.get('/api/auth/me', async (req, reply) => {
    const uid = sessionUserId(req);
    if (!uid) return reply.code(401).send({ error: '로그인이 필요합니다.' });
    const user = await repo.userById(uid);
    if (!user) {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.code(401).send({ error: '로그인이 필요합니다.' });
    }
    return { user };
  });

  app.delete('/api/auth/session', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ── 조회 ──────────────────────────────────────────────────────────────

  app.get('/api/snapshot', async (req, reply) => {
    const uid = await requireUser(req, reply);
    if (!uid) return;
    return { db: await repo.snapshot() };
  });

  // ── 명령 ──────────────────────────────────────────────────────────────
  // 모든 명령의 행위자는 세션에서 온다. 바디의 user id 는 권한에 쓰지 않는다.

  const emit = (m: { changed: boolean }, scope: string): void => {
    if (m.changed) hub.broadcast(scope);
  };

  app.post('/api/friends', async (req, reply) => {
    const uid = await requireUser(req, reply);
    if (!uid) return;
    const { code } = (req.body ?? {}) as { code?: string };
    const m = await repo.addFriendByCode(uid, code ?? '');
    emit(m, 'friends');
    return m.result;
  });

  app.post('/api/friends/:friendId/favorite', async (req, reply) => {
    const uid = await requireUser(req, reply);
    if (!uid) return;
    const { friendId } = req.params as { friendId: string };
    const m = await repo.toggleFavorite(uid, friendId);
    emit(m, 'friends');
    return { ok: true };
  });

  app.delete('/api/friends/:friendId', async (req, reply) => {
    const uid = await requireUser(req, reply);
    if (!uid) return;
    const { friendId } = req.params as { friendId: string };
    const m = await repo.removeFriend(uid, friendId);
    emit(m, 'friends');
    return { ok: true };
  });

  app.post('/api/chats/direct', async (req, reply) => {
    const uid = await requireUser(req, reply);
    if (!uid) return;
    const { targetId } = (req.body ?? {}) as { targetId?: string };
    if (!targetId) return reply.code(400).send({ error: 'targetId 가 필요합니다.' });
    const target = await repo.userById(targetId);
    if (!target) return reply.code(404).send({ error: '상대를 찾을 수 없습니다.' });
    // 방 멤버는 세션 사용자 + 대상. 바디로 다른 사람을 끼워넣을 수 없다.
    const m = await repo.openDirectChat(uid, targetId);
    emit(m, 'chats');
    return { chatId: m.result };
  });

  app.post('/api/chats/:chatId/messages', async (req, reply) => {
    const uid = await requireUser(req, reply);
    if (!uid) return;
    const { chatId } = req.params as { chatId: string };
    const { text, clientKey } = (req.body ?? {}) as { text?: string; clientKey?: string };
    const m = await repo.withIdempotency('message', uid, clientKey, () =>
      repo.sendMessage(chatId, uid, text ?? ''),
    );
    emit(m, 'messages');
    return m.result;
  });

  app.post('/api/chats/:chatId/read', async (req, reply) => {
    const uid = await requireUser(req, reply);
    if (!uid) return;
    const { chatId } = req.params as { chatId: string };
    const m = await repo.markRead(chatId, uid);
    emit(m, 'reads');
    return { ok: true };
  });

  app.post('/api/gifts', async (req, reply) => {
    const uid = await requireUser(req, reply);
    if (!uid) return;
    const { receiverId, productId, message, clientKey } = (req.body ?? {}) as {
      receiverId?: string;
      productId?: string;
      message?: string;
      clientKey?: string;
    };
    if (!receiverId || !productId) {
      return reply.code(400).send({ error: 'receiverId 와 productId 가 필요합니다.' });
    }
    // 보낸 사람은 세션 사용자로 강제한다.
    const m = await repo.withIdempotency('gift', uid, clientKey, () =>
      repo.sendGift({ senderId: uid, receiverId, productId, message: message ?? '' }),
    );
    emit(m, 'gifts');
    return m.result;
  });

  app.post('/api/gifts/:orderId/actions', async (req, reply) => {
    const uid = await requireUser(req, reply);
    if (!uid) return;
    const { orderId } = req.params as { orderId: string };
    const { action } = (req.body ?? {}) as { action?: string };
    if (!action) return reply.code(400).send({ error: 'action 이 필요합니다.' });
    // FORCE_EXPIRE 는 데모 전용이라 운영 API 경계에서 거절한다.
    if (action === 'FORCE_EXPIRE') {
      return reply.code(400).send({ ok: false, reason: '허용되지 않은 동작입니다.' });
    }
    const m = await repo.giftAction(orderId, uid, action as GiftAction);
    emit(m, 'gifts');
    return m.result;
  });

  // ── dev 전용 seed/reset ────────────────────────────────────────────────
  // 운영에는 reset 이 없어야 한다. DEV_TOOLS/테스트에서만 열린다. 문서에 명시.
  if (deps.devTools) {
    app.post('/api/dev/reset', async () => {
      await resetDatabase(deps.pool);
      hub.broadcast('reset');
      return { ok: true };
    });
    app.post('/api/dev/seed', async () => {
      const users = await seedDemoUsers(deps.pool);
      hub.broadcast('reset');
      return { users };
    });
  }

  // ── WebSocket ──────────────────────────────────────────────────────────
  // 세션 쿠키로 인증한다. 인증 실패면 닫는다.
  app.register(async (scoped) => {
    scoped.get('/ws', { websocket: true }, (socket, req) => {
      const uid = sessionUserId(req);
      if (!uid) {
        socket.close(1008, 'unauthorized');
        return;
      }
      hub.add(socket);
      socket.send(JSON.stringify({ type: 'hello' }));
    });
  });

  return app;
};

/** 모든 테이블을 비운다 (dev/test 전용). */
export const resetDatabase = async (pool: Pool): Promise<void> => {
  await pool.query(
    `TRUNCATE idempotency_keys, gift_orders, reads, messages, chat_members, chats, friendships, users RESTART IDENTITY CASCADE`,
  );
};

/** 데모 사용자 4명을 심는다 (dev/test 전용). */
export const seedDemoUsers = async (pool: Pool): Promise<Array<{ id: string; code: string; name: string }>> => {
  const users = seedUsers();
  for (const u of users) {
    await pool.query(
      `INSERT INTO users (id, code, name, status_message, hue, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (code) DO NOTHING`,
      [u.id, u.code, u.name, u.statusMessage, u.hue, u.createdAt],
    );
  }
  return users.map((u) => ({ id: u.id, code: u.code, name: u.name }));
};

export { runMigrations };
