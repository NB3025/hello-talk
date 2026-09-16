/**
 * 엔드투엔드 검증 스크립트.
 *
 * 진짜 서버 + 진짜 PostgreSQL + 진짜 WebSocket 을 상대로 두 개의 독립 세션(쿠키 항아리
 * 두 개)을 몰아 전체 흐름을 증명한다. localStorage 도, 목도 쓰지 않는다.
 *
 * 왜 한 프로세스 안에서 다 하나: 이 실행 환경의 각 셸 명령은 수명이 짧은 PID·네트워크
 * 네임스페이스에서 돌아, 한 명령에서 띄운 서버를 다른 명령에서 붙을 수 없다(127.0.0.1
 * = EHOSTUNREACH). 그래서 DB 자식 프로세스 + Fastify(in-process) + WebSocket 클라이언트를
 * 모두 이 한 번의 실행 수명 안에서 띄우고, 흐름을 돌린 뒤 실패하면 nonzero 로 나간다.
 *
 * 실행:  npm run e2e     (server/ 에서)
 *
 * 증명하는 것:
 *  1. 사용자 A·B 생성 (서버가 발급한 친구 코드)
 *  2. A 가 B 를 친구 코드로 등록 (단방향 확인)
 *  3. A<->B 1:1 방 열기 (멱등: 두 번째 열기도 같은 방)
 *  4. A 가 메시지 전송 → B 가 WebSocket 푸시로 수신, 읽음 상태(B 안읽음 증가 →
 *     markRead 로 0, A 는 B 의 lastReadAt 전진/'읽음' 확인)
 *  5. A 가 B 에게 선물 → 선물 주문 + 선물 메시지가 방에 원자적으로 안착 → B 가 수락
 *     (accepted, 90일 교환권, 소유권 이전) → 추가 생애 동작 1개(EXTEND) + 권한 실패 1개
 *     (당사자 아님/잘못된 행위자가 도메인 사유로 거절되고 상태 변화 없음)
 */
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { buildApp, resetDatabase, runMigrations } from '../src/app';
import { makePool, type Pool } from '../src/db/pool';
import {
  giftStatus,
  voucherDaysLeft,
  type GiftOrder,
} from '../../src/domain/gift';
import { productById } from '../../src/domain/products';
import { directChatBetween, unreadCount, lastReadAt } from '../../src/domain/selectors';
import type { Db } from '../../src/domain/types';

const COOKIE_SECRET = 'e2e-cookie-secret-0123456789abcdef';
const PRODUCT = 'p-americano';

// ── 작은 단언 유틸 ─────────────────────────────────────────────────────
let passed = 0;
const ok = (cond: boolean, label: string): void => {
  if (!cond) throw new Error(`FAIL: ${label}`);
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ok  ${label}`);
};
const eq = (actual: unknown, expected: unknown, label: string): void =>
  ok(actual === expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);

// ── DB 자식 프로세스 (globalSetup 과 같은 방식) ─────────────────────────
const startPostgres = async (): Promise<{ pgproc: ChildProcess; sock: string; base: string }> => {
  const base = `/tmp/htpg_e2e_${process.pid}_${Date.now()}`;
  const data = `${base}/data`;
  const sock = `${base}/sock`;
  mkdirSync(data, { recursive: true });
  mkdirSync(sock, { recursive: true });
  execSync(`chown -R postgres:postgres ${base}`);
  execSync(`su postgres -c "/usr/bin/initdb -D ${data} -U postgres -A trust --no-sync"`, {
    stdio: 'ignore',
  });
  const launch = `${base}/launch.sh`;
  writeFileSync(launch, `#!/bin/sh\nexec /usr/bin/postgres -D ${data} -k ${sock} -c listen_addresses=''\n`);
  chmodSync(launch, 0o777);
  execSync(`chown postgres:postgres ${launch}`);
  execSync(`chmod 777 ${sock}`);
  const pgproc = spawn('su', ['postgres', '-c', launch], { stdio: ['ignore', 'ignore', 'inherit'] });

  const { Client } = pg;
  for (let i = 0; i < 60; i += 1) {
    const client = new Client({ host: sock, user: 'postgres', database: 'postgres' });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return { pgproc, sock, base };
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  pgproc.kill('SIGQUIT');
  throw new Error('e2e: PostgreSQL 가 뜨지 않았습니다.');
};

// ── HTTP 헬퍼 (쿠키 항아리별) ───────────────────────────────────────────
interface Session {
  name: string;
  cookie: string;
  userId: string;
  code: string;
}

const post = async (
  baseUrl: string,
  path: string,
  cookie: string | undefined,
  body?: unknown,
): Promise<{ status: number; json: any; setCookie: string | null }> => {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  const json = await res.json().catch(() => null);
  return { status: res.status, json, setCookie };
};

const getSnapshot = async (baseUrl: string, cookie: string): Promise<Db> => {
  const res = await fetch(`${baseUrl}/api/snapshot`, { headers: { cookie } });
  const body = (await res.json()) as { db: Db };
  return body.db;
};

const sessionCookie = (setCookie: string | null): string => {
  if (!setCookie) throw new Error('no set-cookie');
  const part = setCookie.split(/,(?=\s*ht_session=)/).find((c) => c.trim().startsWith('ht_session='));
  const first = part ?? setCookie;
  return first.split(';')[0]!.trim();
};

// ── WebSocket 클라이언트 ────────────────────────────────────────────────
interface WsClient {
  socket: WebSocket;
  changes: Array<{ type: string; scope?: string }>;
  close: () => void;
}

const openWs = (wsUrl: string, cookie: string): Promise<WsClient> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl, { headers: { cookie } });
    const changes: Array<{ type: string; scope?: string }> = [];
    socket.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'change') changes.push(msg);
    });
    socket.once('open', () => resolve({ socket, changes, close: () => socket.close() }));
    socket.once('error', reject);
    setTimeout(() => reject(new Error('ws open timeout')), 3000);
  });

const waitFor = async (fn: () => boolean, ms = 2000): Promise<boolean> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return fn();
};

// ── 메인 흐름 ──────────────────────────────────────────────────────────
const run = async (): Promise<void> => {
  const { pgproc, sock, base } = await startPostgres();
  process.env.PGHOST = sock;
  process.env.PGUSER = 'postgres';
  process.env.PGDATABASE = 'postgres';

  let pool: Pool | undefined;
  let app: FastifyInstance | undefined;
  try {
    pool = makePool('unused-when-socket');
    await runMigrations(pool);
    await resetDatabase(pool);
    app = buildApp({ pool, cookieSecret: COOKIE_SECRET, devTools: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;
    // eslint-disable-next-line no-console
    console.log(`e2e: server up at ${baseUrl}`);

    // 1) 사용자 A·B 생성 (서버 발급 코드) — 세션(쿠키) 두 개
    // eslint-disable-next-line no-console
    console.log('\n[1] create user A and B');
    const aCreate = await post(baseUrl, '/api/auth/session', undefined, { name: '홍길동' });
    eq(aCreate.status, 201, 'A 생성 201');
    const A: Session = {
      name: '홍길동',
      cookie: sessionCookie(aCreate.setCookie),
      userId: aCreate.json.user.id,
      code: aCreate.json.user.code,
    };
    const bCreate = await post(baseUrl, '/api/auth/session', undefined, { name: '김철수' });
    eq(bCreate.status, 201, 'B 생성 201');
    const B: Session = {
      name: '김철수',
      cookie: sessionCookie(bCreate.setCookie),
      userId: bCreate.json.user.id,
      code: bCreate.json.user.code,
    };
    ok(A.userId !== B.userId, '서로 다른 사용자');
    ok(Boolean(A.code) && A.code !== B.code, '서버 발급 친구 코드가 서로 다름');
    ok(A.cookie.startsWith('ht_session=') && A.cookie !== B.cookie, '독립 세션 쿠키 두 개');

    // WebSocket 두 개 열기 (각 세션 인증)
    const wsA = await openWs(wsUrl, A.cookie);
    const wsB = await openWs(wsUrl, B.cookie);

    // 미인증 WS 는 거절되어야 한다 (권한)
    const unauthClose = await new Promise<number>((resolve, reject) => {
      const s = new WebSocket(wsUrl);
      s.once('close', (code) => resolve(code));
      s.once('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });
    eq(unauthClose, 1008, '미인증 WebSocket 은 1008 로 닫힘');

    // 2) A 가 B 를 친구 코드로 등록 (단방향)
    // eslint-disable-next-line no-console
    console.log('\n[2] A adds B by friend code');
    const add = await post(baseUrl, '/api/friends', A.cookie, { code: B.code });
    eq(add.status, 200, 'addFriend 200');
    eq(add.json.ok, true, 'addFriend ok');
    eq(add.json.friend.id, B.userId, '친구가 B');
    await waitFor(() => wsA.changes.some((c) => c.scope === 'friends'));
    ok(wsA.changes.some((c) => c.scope === 'friends'), 'A 가 friends 변경 신호 수신');

    const snapA1 = await getSnapshot(baseUrl, A.cookie);
    ok(
      snapA1.friendships.some((f) => f.ownerId === A.userId && f.friendId === B.userId),
      'A→B 친구 관계 존재',
    );
    ok(
      !snapA1.friendships.some((f) => f.ownerId === B.userId && f.friendId === A.userId),
      '역방향(B→A)은 생기지 않음 (단방향)',
    );

    // 중복 등록 거절 (사람이 읽는 사유)
    const dup = await post(baseUrl, '/api/friends', A.cookie, { code: B.code });
    eq(dup.json.ok, false, '중복 등록 거절');
    ok(String(dup.json.reason).includes('이미 친구'), '중복 사유 문구');

    // 3) A<->B 1:1 방 열기 (멱등)
    // eslint-disable-next-line no-console
    console.log('\n[3] open direct chat (idempotent)');
    const open1 = await post(baseUrl, '/api/chats/direct', A.cookie, { targetId: B.userId });
    eq(open1.status, 200, 'openDirect 200');
    const chatId = open1.json.chatId as string;
    ok(Boolean(chatId), 'chatId 반환');
    const open2 = await post(baseUrl, '/api/chats/direct', A.cookie, { targetId: B.userId });
    eq(open2.json.chatId, chatId, '두 번째 열기도 같은 방 (멱등)');
    // B 쪽에서도 같은 방으로 수렴
    const openFromB = await post(baseUrl, '/api/chats/direct', B.cookie, { targetId: A.userId });
    eq(openFromB.json.chatId, chatId, 'B 가 열어도 같은 방 (순서 무관)');
    const snapAfterOpen = await getSnapshot(baseUrl, A.cookie);
    const directRooms = snapAfterOpen.chats.filter(
      (c) => !c.title && c.memberIds.includes(A.userId) && c.memberIds.includes(B.userId),
    );
    eq(directRooms.length, 1, '두 사람 사이 방은 정확히 1개');
    ok(Boolean(directChatBetween(snapAfterOpen, A.userId, B.userId)), 'directChatBetween 로도 확인');

    // 4) A 가 메시지 → B 가 WS 로 수신, 읽음 상태
    // eslint-disable-next-line no-console
    console.log('\n[4] A sends message, B receives via WS, read state');
    const bChangesBefore = wsB.changes.length;
    const msg = await post(baseUrl, `/api/chats/${chatId}/messages`, A.cookie, {
      text: '안녕하세요 김철수님',
      clientKey: 'msg-1',
    });
    eq(msg.json.ok, true, '메시지 전송 ok');
    // B 가 WebSocket 푸시(messages)를 받는다
    await waitFor(() => wsB.changes.length > bChangesBefore && wsB.changes.some((c) => c.scope === 'messages'));
    ok(wsB.changes.some((c) => c.scope === 'messages'), 'B 가 messages 변경 신호 수신(WS 푸시)');

    // 멱등: 같은 clientKey 로 재시도해도 중복 메시지 없음
    await post(baseUrl, `/api/chats/${chatId}/messages`, A.cookie, {
      text: '안녕하세요 김철수님',
      clientKey: 'msg-1',
    });

    let snapB = await getSnapshot(baseUrl, B.cookie);
    eq(snapB.messages.filter((m) => m.chatId === chatId && m.senderId === A.userId && m.kind !== 'gift').length, 1, '재시도해도 메시지 1개 (멱등)');
    eq(unreadCount(snapB, chatId, B.userId), 1, 'B 안읽음 1');
    eq(unreadCount(snapB, chatId, A.userId), 0, '보낸 사람 A 자신은 안읽음 0');

    // B 가 읽음 처리 → 안읽음 0, A 는 B 의 lastReadAt 전진('읽음') 확인
    const aBReadBefore = lastReadAt(await getSnapshot(baseUrl, A.cookie), chatId, B.userId);
    const read = await post(baseUrl, `/api/chats/${chatId}/read`, B.cookie, {});
    eq(read.status, 200, 'markRead 200');
    await waitFor(() => wsA.changes.some((c) => c.scope === 'reads'));
    ok(wsA.changes.some((c) => c.scope === 'reads'), 'A 가 reads 변경 신호 수신');
    snapB = await getSnapshot(baseUrl, B.cookie);
    eq(unreadCount(snapB, chatId, B.userId), 0, 'markRead 후 B 안읽음 0');
    const aBReadAfter = lastReadAt(await getSnapshot(baseUrl, A.cookie), chatId, B.userId);
    ok(aBReadAfter > aBReadBefore, "A 시점에서 B 의 lastReadAt 전진('읽음')");

    // no-op markRead 는 신호를 내지 않는다
    const aReadsBefore = wsA.changes.filter((c) => c.scope === 'reads').length;
    await post(baseUrl, `/api/chats/${chatId}/read`, B.cookie, {});
    await new Promise((r) => setTimeout(r, 300));
    eq(wsA.changes.filter((c) => c.scope === 'reads').length, aReadsBefore, 'no-op markRead 는 브로드캐스트 없음');

    // 5) A 가 B 에게 선물 → 원자적 안착 → B 수락 → EXTEND → 권한 실패
    // eslint-disable-next-line no-console
    console.log('\n[5] gift lifecycle');
    const price = productById(PRODUCT)!.price;
    const gift = await post(baseUrl, '/api/gifts', A.cookie, {
      receiverId: B.userId,
      productId: PRODUCT,
      message: '커피 한 잔 해요',
      clientKey: 'gift-1',
    });
    eq(gift.json.ok, true, '선물 전송 ok');
    const orderId = gift.json.orderId as string;
    eq(gift.json.chatId, chatId, '선물이 기존 1:1 방에 안착');

    // 원자적: 선물 주문 + 선물 메시지가 같은 방에 함께 생겼다
    let snap = await getSnapshot(baseUrl, B.cookie);
    const order0 = snap.giftOrders.find((o) => o.id === orderId)!;
    ok(Boolean(order0), '선물 주문 생성됨');
    eq(order0.status, 'paid', '초기 상태 paid');
    ok(
      snap.messages.some((m) => m.chatId === chatId && m.kind === 'gift' && m.giftOrderId === orderId),
      '선물 메시지가 같은 방에 원자적으로 안착',
    );
    // B 가 선물 WS 푸시 수신
    await waitFor(() => wsB.changes.some((c) => c.scope === 'gifts'));
    ok(wsB.changes.some((c) => c.scope === 'gifts'), 'B 가 gifts 변경 신호 수신');

    // 권한 실패 1: 당사자가 아닌 제3자(C)의 동작은 도메인 사유로 거절, 상태 변화 없음
    const cCreate = await post(baseUrl, '/api/auth/session', undefined, { name: '이영희' });
    const C: Session = {
      name: '이영희',
      cookie: sessionCookie(cCreate.setCookie),
      userId: cCreate.json.user.id,
      code: cCreate.json.user.code,
    };
    const outsider = await post(baseUrl, `/api/gifts/${orderId}/actions`, C.cookie, { action: 'ACCEPT' });
    eq(outsider.json.ok, false, '제3자 수락 거절');
    ok(String(outsider.json.reason).includes('당사자'), '거절 사유: 당사자가 아님');

    // 권한 실패 2: 잘못된 행위자 — 보낸 사람 A 가 ACCEPT 시도 (받는 사람만 가능)
    const wrongActor = await post(baseUrl, `/api/gifts/${orderId}/actions`, A.cookie, { action: 'ACCEPT' });
    eq(wrongActor.json.ok, false, '보낸 사람 ACCEPT 거절');
    ok(String(wrongActor.json.reason).includes('받는 사람'), '거절 사유: 받는 사람만');

    // 거절들 이후에도 상태는 그대로 paid (상태 변화 없음)
    snap = await getSnapshot(baseUrl, B.cookie);
    eq(snap.giftOrders.find((o) => o.id === orderId)!.status, 'paid', '거절 후에도 상태 paid 유지');

    // FORCE_EXPIRE 는 API 경계에서 거절
    const forced = await post(baseUrl, `/api/gifts/${orderId}/actions`, B.cookie, { action: 'FORCE_EXPIRE' });
    eq(forced.status, 400, 'FORCE_EXPIRE 400 거절');

    // B 가 수락 → accepted, 90일 교환권, 소유권 이전
    const accept = await post(baseUrl, `/api/gifts/${orderId}/actions`, B.cookie, { action: 'ACCEPT' });
    eq(accept.json.ok, true, 'B 수락 ok');
    const now = Date.now();
    snap = await getSnapshot(baseUrl, B.cookie);
    const accepted: GiftOrder = snap.giftOrders.find((o) => o.id === orderId)!;
    eq(accepted.status, 'accepted', '상태 accepted');
    eq(giftStatus(accepted, now), 'accepted', '계산 상태 accepted (사용중)');
    const daysLeft = voucherDaysLeft(accepted, now);
    ok(daysLeft === 90 || daysLeft === 89, `90일 교환권 (남은 ${daysLeft}일)`);
    eq(accepted.receiverId, B.userId, '소유권은 받는 사람 B');

    // 추가 생애 동작: EXTEND (받는 사람 B, 1회만 가능)
    const extend = await post(baseUrl, `/api/gifts/${orderId}/actions`, B.cookie, { action: 'EXTEND' });
    eq(extend.json.ok, true, 'B 연장 ok');
    snap = await getSnapshot(baseUrl, B.cookie);
    const extended: GiftOrder = snap.giftOrders.find((o) => o.id === orderId)!;
    eq(extended.extensionsUsed, 1, '연장 1회 사용');
    const daysLeft2 = voucherDaysLeft(extended, Date.now());
    ok(daysLeft2 >= 179 && daysLeft2 <= 180, `연장 후 약 180일 (남은 ${daysLeft2}일)`);

    // 두 번째 연장은 거절 (1회 제한)
    const extend2 = await post(baseUrl, `/api/gifts/${orderId}/actions`, B.cookie, { action: 'EXTEND' });
    eq(extend2.json.ok, false, '두 번째 연장 거절 (1회 제한)');

    // 멱등 선물: 같은 clientKey 재시도해도 주문 1개
    await post(baseUrl, '/api/gifts', A.cookie, {
      receiverId: B.userId,
      productId: PRODUCT,
      message: '커피 한 잔 해요',
      clientKey: 'gift-1',
    });
    snap = await getSnapshot(baseUrl, B.cookie);
    eq(snap.giftOrders.length, 1, '멱등: 선물 주문은 1개');

    wsA.close();
    wsB.close();

    // eslint-disable-next-line no-console
    console.log(`\n✅ e2e 통과: ${passed} assertions (users, friend, direct chat, message+read via WS, gift accept+extend+authorization)`);
  } finally {
    if (app) await app.close();
    if (pool) await pool.end();
    pgproc.kill('SIGQUIT');
    await new Promise((r) => setTimeout(r, 300));
    rmSync(base, { recursive: true, force: true });
  }
};

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`\n❌ e2e 실패:`, err);
  process.exit(1);
});
