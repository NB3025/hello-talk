import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase } from '../src/app';
import { productById } from '../../src/domain/products';
import { createUserSession, startTestApp, stopTestApp, type TestContext } from './helpers';

const PRODUCT = 'p-americano';
const PRICE = productById(PRODUCT)!.price;

interface Party {
  userId: string;
  cookie: string;
}

const sendGift = (ctx: TestContext, sender: Party, receiverId: string, extra: Record<string, unknown> = {}) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/gifts',
    headers: { cookie: sender.cookie },
    payload: { receiverId, productId: PRODUCT, message: '축하해요', ...extra },
  });

const act = (ctx: TestContext, actor: Party, orderId: string, action: string) =>
  ctx.app.inject({
    method: 'POST',
    url: `/api/gifts/${orderId}/actions`,
    headers: { cookie: actor.cookie },
    payload: { action },
  });

const orderById = async (ctx: TestContext, viewer: Party, orderId: string) => {
  const snap = await ctx.app.inject({ method: 'GET', url: '/api/snapshot', headers: { cookie: viewer.cookie } });
  const orders = snap.json().db.giftOrders as Array<Record<string, unknown>>;
  return orders.find((o) => o.id === orderId);
};

describe('gift lifecycle through the API', () => {
  let ctx: TestContext;
  let sender: Party;
  let receiver: Party;

  beforeAll(async () => {
    ctx = await startTestApp();
  });
  afterAll(async () => {
    await stopTestApp(ctx);
  });
  beforeEach(async () => {
    await resetDatabase(ctx.pool);
    const s = await createUserSession(ctx.app, '홍길동');
    const r = await createUserSession(ctx.app, '김철수');
    sender = { userId: s.userId, cookie: s.cookie };
    receiver = { userId: r.userId, cookie: r.cookie };
  });

  it('sendGift creates a gift order + gift message in a direct chat', async () => {
    const res = await sendGift(ctx, sender, receiver.userId);
    expect(res.json().ok).toBe(true);
    const orderId = res.json().orderId as string;
    const chatId = res.json().chatId as string;

    const snap = (await ctx.app.inject({ method: 'GET', url: '/api/snapshot', headers: { cookie: sender.cookie } })).json();
    const order = (snap.db.giftOrders as Array<Record<string, unknown>>).find((o) => o.id === orderId);
    expect(order?.status).toBe('paid');
    expect(order?.price).toBe(PRICE);
    const giftMsg = (snap.db.messages as Array<Record<string, unknown>>).find(
      (m) => m.kind === 'gift' && m.giftOrderId === orderId,
    );
    expect(giftMsg?.chatId).toBe(chatId);
  });

  it('rejects self-gift and unknown product', async () => {
    const self = await sendGift(ctx, sender, sender.userId);
    expect(self.json()).toEqual({ ok: false, reason: '자기 자신에게는 선물할 수 없습니다.' });

    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/gifts',
      headers: { cookie: sender.cookie },
      payload: { receiverId: receiver.userId, productId: 'nope', message: '' },
    });
    expect(bad.json()).toEqual({ ok: false, reason: '상품을 찾을 수 없습니다.' });
  });

  it('ACCEPT issues a 90-day voucher and transfers ownership to the receiver', async () => {
    const orderId = (await sendGift(ctx, sender, receiver.userId)).json().orderId as string;
    const res = await act(ctx, receiver, orderId, 'ACCEPT');
    expect(res.json().ok).toBe(true);
    const order = await orderById(ctx, receiver, orderId);
    expect(order?.status).toBe('accepted');
    const expiresAt = order?.expiresAt as number;
    const paidAt = order?.paidAt as number;
    const days = Math.round((expiresAt - paidAt) / 86_400_000);
    expect(days).toBe(90);
  });

  it('DECLINE refunds full amount to the payer (sender)', async () => {
    const orderId = (await sendGift(ctx, sender, receiver.userId)).json().orderId as string;
    const res = await act(ctx, receiver, orderId, 'DECLINE');
    expect(res.json().ok).toBe(true);
    const order = await orderById(ctx, receiver, orderId);
    expect(order?.status).toBe('refunded');
    expect(order?.refundAmount).toBe(PRICE);
    const ledger = order?.ledger as Array<{ partyId: string; amount: number }>;
    const refund = ledger.find((e) => e.amount > 0);
    // 환불금은 결제한 사람(sender)에게 간다.
    expect(refund?.partyId).toBe(sender.userId);
  });

  it('CANCEL_BY_SENDER (before accept) refunds full amount to the sender', async () => {
    const orderId = (await sendGift(ctx, sender, receiver.userId)).json().orderId as string;
    const res = await act(ctx, sender, orderId, 'CANCEL_BY_SENDER');
    expect(res.json().ok).toBe(true);
    const order = await orderById(ctx, sender, orderId);
    expect(order?.status).toBe('refunded');
    expect(order?.refundAmount).toBe(PRICE);
  });

  it('USE marks the voucher used after ACCEPT', async () => {
    const orderId = (await sendGift(ctx, sender, receiver.userId)).json().orderId as string;
    await act(ctx, receiver, orderId, 'ACCEPT');
    const res = await act(ctx, receiver, orderId, 'USE');
    expect(res.json().ok).toBe(true);
    const order = await orderById(ctx, receiver, orderId);
    expect(order?.status).toBe('used');
  });

  it('EXTEND works once only', async () => {
    const orderId = (await sendGift(ctx, sender, receiver.userId)).json().orderId as string;
    await act(ctx, receiver, orderId, 'ACCEPT');
    const first = await act(ctx, receiver, orderId, 'EXTEND');
    expect(first.json().ok).toBe(true);
    const second = await act(ctx, receiver, orderId, 'EXTEND');
    expect(second.json()).toEqual({ ok: false, reason: '연장은 1번까지만 가능합니다.' });
    const order = await orderById(ctx, receiver, orderId);
    expect(order?.extensionsUsed).toBe(1);
  });

  it('expired voucher refunds 90% to the sender via REFUND_EXPIRED', async () => {
    const orderId = (await sendGift(ctx, sender, receiver.userId)).json().orderId as string;
    await act(ctx, receiver, orderId, 'ACCEPT');
    // 시간이 지나 만료된 상황을 만든다: expires_at 을 과거로 밀어 둔다.
    await ctx.pool.query('UPDATE gift_orders SET expires_at = $1 WHERE id = $2', [Date.now() - 1000, orderId]);

    const res = await act(ctx, sender, orderId, 'REFUND_EXPIRED');
    expect(res.json().ok).toBe(true);
    const order = await orderById(ctx, sender, orderId);
    expect(order?.status).toBe('refunded');
    expect(order?.refundAmount).toBe(Math.round(PRICE * 0.9));
    const ledger = order?.ledger as Array<{ partyId: string; amount: number }>;
    expect(ledger.find((e) => e.amount > 0)?.partyId).toBe(sender.userId);
  });

  // ── 권한 ────────────────────────────────────────────────────────────

  it('rejects a non-party actor with the domain reason and does not mutate state', async () => {
    const orderId = (await sendGift(ctx, sender, receiver.userId)).json().orderId as string;
    const outsider = await createUserSession(ctx.app, '이영희');
    const res = await act(ctx, { userId: outsider.userId, cookie: outsider.cookie }, orderId, 'ACCEPT');
    expect(res.json()).toEqual({ ok: false, reason: '이 선물의 당사자가 아닙니다.' });
    const order = await orderById(ctx, sender, orderId);
    expect(order?.status).toBe('paid');
  });

  it('rejects the wrong actor (sender cannot ACCEPT) and does not mutate state', async () => {
    const orderId = (await sendGift(ctx, sender, receiver.userId)).json().orderId as string;
    const res = await act(ctx, sender, orderId, 'ACCEPT');
    expect(res.json()).toEqual({ ok: false, reason: '받는 사람만 응답할 수 있습니다.' });
    const order = await orderById(ctx, sender, orderId);
    expect(order?.status).toBe('paid');
  });

  it('the actor comes from the session, not the body (cannot impersonate)', async () => {
    // sender 가 receiver 인 척 바디에 다른 값을 넣어도, 세션이 sender 라 ACCEPT 는 거절된다.
    const orderId = (await sendGift(ctx, sender, receiver.userId)).json().orderId as string;
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/gifts/${orderId}/actions`,
      headers: { cookie: sender.cookie },
      payload: { action: 'ACCEPT', actorId: receiver.userId },
    });
    expect(res.json()).toEqual({ ok: false, reason: '받는 사람만 응답할 수 있습니다.' });
  });

  it('rejects FORCE_EXPIRE at the API boundary', async () => {
    const orderId = (await sendGift(ctx, sender, receiver.userId)).json().orderId as string;
    await act(ctx, receiver, orderId, 'ACCEPT');
    const res = await act(ctx, receiver, orderId, 'FORCE_EXPIRE');
    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
    // 상태는 그대로.
    const order = await orderById(ctx, receiver, orderId);
    expect(order?.status).toBe('accepted');
  });

  it('idempotent gift send does not duplicate on retry', async () => {
    const r1 = await sendGift(ctx, sender, receiver.userId, { clientKey: 'gift-key-1' });
    const r2 = await sendGift(ctx, sender, receiver.userId, { clientKey: 'gift-key-1' });
    expect(r1.json().orderId).toBe(r2.json().orderId);
    const snap = (await ctx.app.inject({ method: 'GET', url: '/api/snapshot', headers: { cookie: sender.cookie } })).json();
    expect((snap.db.giftOrders as unknown[]).length).toBe(1);
    // 선물 메시지도 하나뿐이어야 한다.
    const giftMsgs = (snap.db.messages as Array<{ kind?: string }>).filter((m) => m.kind === 'gift');
    expect(giftMsgs.length).toBe(1);
  });
});
