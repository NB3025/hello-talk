import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  GIFT_RULES,
  applyGiftAction,
  checkGiftAction,
  giftStatus,
  newGiftOrder,
  voucherDaysLeft,
  type GiftAction,
  type GiftOrder,
} from './gift';

const SENDER = 'u-sender';
const RECEIVER = 'u-receiver';
const STRANGER = 'u-stranger';
const T0 = 1_700_000_000_000;

const order = (): GiftOrder =>
  newGiftOrder({
    id: 'o1',
    productId: 'p-americano',
    senderId: SENDER,
    receiverId: RECEIVER,
    chatId: 'c1',
    message: '생일 축하해',
    price: 10_000,
    at: T0,
  });

/** 성공을 전제로 다음 상태를 꺼낸다. 실패하면 테스트가 그 자리에서 죽는다. */
const step = (o: GiftOrder, action: GiftAction, actor: string, at: number): GiftOrder => {
  const r = applyGiftAction(o, action, actor, at);
  if (!r.ok) throw new Error(`${action} 이 거절됨: ${r.reason}`);
  return r.order;
};

describe('선물 주문 · 상태', () => {
  it('결제하면 응답 대기 상태로 시작하고 결제 기록이 남는다', () => {
    const o = order();
    expect(o.status).toBe('paid');
    expect(o.ledger).toHaveLength(1);
    expect(o.ledger[0]?.amount).toBe(-10_000);
    // 돈이 움직인 당사자는 언제나 결제한 사람이다.
    expect(o.ledger[0]?.partyId).toBe(SENDER);
  });

  it('수락하면 90일 교환권이 발급된다', () => {
    const o = step(order(), 'ACCEPT', RECEIVER, T0);
    expect(o.status).toBe('accepted');
    expect(o.expiresAt).toBe(T0 + GIFT_RULES.VOUCHER_DAYS * DAY_MS);
    expect(voucherDaysLeft(o, T0)).toBe(GIFT_RULES.VOUCHER_DAYS);
  });

  it('만료는 저장하지 않고 계산한다', () => {
    const o = step(order(), 'ACCEPT', RECEIVER, T0);
    // 저장된 상태는 그대로 accepted 인데
    expect(o.status).toBe('accepted');
    // 유효기간이 지난 시점에서 보면 expired 다.
    expect(giftStatus(o, T0 + 89 * DAY_MS)).toBe('accepted');
    expect(giftStatus(o, T0 + 91 * DAY_MS)).toBe('expired');
    expect(voucherDaysLeft(o, T0 + 91 * DAY_MS)).toBe(0);
  });
});

describe('선물 주문 · 소유권', () => {
  it('수락 전에는 보낸 사람이 취소할 수 있다', () => {
    expect(checkGiftAction(order(), 'CANCEL_BY_SENDER', SENDER, T0)).toBeNull();
  });

  it('수락 후에는 보낸 사람이 되돌릴 수 없다 — 주인이 바뀌었다', () => {
    const accepted = step(order(), 'ACCEPT', RECEIVER, T0);
    const refusal = checkGiftAction(accepted, 'CANCEL_BY_SENDER', SENDER, T0);
    expect(refusal).toMatch(/받는 사람 것/);
  });

  it('받는 사람이 취소해도 환불금은 결제한 사람에게 간다', () => {
    const accepted = step(order(), 'ACCEPT', RECEIVER, T0);
    const cancelled = step(accepted, 'CANCEL_BY_RECEIVER', RECEIVER, T0 + DAY_MS);
    expect(cancelled.status).toBe('refunded');
    expect(cancelled.refundAmount).toBe(10_000);
    const refund = cancelled.ledger.at(-1);
    expect(refund?.partyId).toBe(SENDER);
    expect(refund?.amount).toBe(10_000);
  });

  it('당사자가 아닌 사람은 아무것도 할 수 없다', () => {
    const o = order();
    const actions: GiftAction[] = ['ACCEPT', 'DECLINE', 'USE', 'CANCEL_BY_SENDER'];
    for (const a of actions) {
      expect(checkGiftAction(o, a, STRANGER, T0)).toBe('이 선물의 당사자가 아닙니다.');
    }
  });

  it('보낸 사람이 자기 선물을 수락할 수는 없다', () => {
    expect(checkGiftAction(order(), 'ACCEPT', SENDER, T0)).toBe('받는 사람만 응답할 수 있습니다.');
  });
});

describe('선물 주문 · 환불', () => {
  it('거절은 전액 환불이다', () => {
    const declined = step(order(), 'DECLINE', RECEIVER, T0);
    expect(declined.status).toBe('refunded');
    expect(declined.refundAmount).toBe(10_000);
    expect(declined.closedBy).toBe('받는 사람 거절');
  });

  it('만료 환불은 90% 이고 10% 는 수수료로 남는다', () => {
    const accepted = step(order(), 'ACCEPT', RECEIVER, T0);
    const later = T0 + 91 * DAY_MS;
    expect(giftStatus(accepted, later)).toBe('expired');

    const refunded = step(accepted, 'REFUND_EXPIRED', SENDER, later);
    expect(refunded.refundAmount).toBe(9_000);
    expect(refunded.ledger.at(-1)?.partyId).toBe(SENDER);
  });

  it('만료 환불은 받는 사람이 신청할 수 없다', () => {
    const accepted = step(order(), 'ACCEPT', RECEIVER, T0);
    const later = T0 + 91 * DAY_MS;
    expect(checkGiftAction(accepted, 'REFUND_EXPIRED', RECEIVER, later)).toMatch(
      /결제한 사람에게 갑니다/,
    );
  });

  it('사용한 선물은 환불도 취소도 되지 않는다', () => {
    const used = step(step(order(), 'ACCEPT', RECEIVER, T0), 'USE', RECEIVER, T0 + DAY_MS);
    expect(used.status).toBe('used');
    expect(checkGiftAction(used, 'CANCEL_BY_SENDER', SENDER, T0 + DAY_MS)).toMatch(/이미 사용된/);
    expect(checkGiftAction(used, 'CANCEL_BY_RECEIVER', RECEIVER, T0 + DAY_MS)).toMatch(
      /받은 상태의 선물만/,
    );
    expect(checkGiftAction(used, 'REFUND_EXPIRED', SENDER, T0 + DAY_MS)).toMatch(/만료된 선물만/);
  });
});

describe('선물 주문 · 연장', () => {
  it('연장은 90일을 더하고 한 번만 된다', () => {
    const accepted = step(order(), 'ACCEPT', RECEIVER, T0);
    const extended = step(accepted, 'EXTEND', RECEIVER, T0 + DAY_MS);

    expect(extended.extensionsUsed).toBe(1);
    // 남은 기간에 더하는 것이지 지금부터 90일이 아니다.
    expect(extended.expiresAt).toBe(
      T0 + (GIFT_RULES.VOUCHER_DAYS + GIFT_RULES.EXTENSION_DAYS) * DAY_MS,
    );
    expect(checkGiftAction(extended, 'EXTEND', RECEIVER, T0 + 2 * DAY_MS)).toMatch(
      /1번까지만/,
    );
  });

  it('이미 만료된 교환권은 연장할 수 없다', () => {
    const accepted = step(order(), 'ACCEPT', RECEIVER, T0);
    expect(checkGiftAction(accepted, 'EXTEND', RECEIVER, T0 + 91 * DAY_MS)).toMatch(
      /남은 길은 환불뿐/,
    );
  });
});

describe('선물 주문 · 불변', () => {
  it('거절된 동작은 상태를 건드리지 않는다', () => {
    const o = order();
    const snapshot = JSON.stringify(o);
    const r = applyGiftAction(o, 'USE', RECEIVER, T0);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(o)).toBe(snapshot);
  });

  it('성공한 동작도 입력 주문을 변형하지 않는다', () => {
    const o = order();
    const snapshot = JSON.stringify(o);
    step(o, 'ACCEPT', RECEIVER, T0);
    expect(JSON.stringify(o)).toBe(snapshot);
  });
});
