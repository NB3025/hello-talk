/**
 * 선물 주문의 생애. `prototypes/gift-order-lifecycle.prototype.html` 의 순수 모듈을
 * 옮긴 것으로, DOM·React·저장소를 모른다.
 *
 * 두 가지를 분리해서 다룬다:
 *  - `checkGiftAction` — 이 동작이 지금 합법인가. 가능하면 null, 아니면 거절 이유.
 *  - `applyGiftAction` — 합법일 때 다음 상태. 불법이면 이유만 돌려주고 상태는 그대로.
 *
 * 화면이 버튼을 회색으로 만들 때도 같은 `checkGiftAction` 을 쓴다. 규칙이 두 곳에
 * 적히면 반드시 어긋나기 때문에, 버튼의 비활성 이유와 실제 거절 이유가 같은 문장이다.
 */

import type { ChatId, Db, UserId } from './types';

export const DAY_MS = 86_400_000;

export const GIFT_RULES = {
  /** 수락 시 발급되는 교환권 유효기간 */
  VOUCHER_DAYS: 90,
  /** 한 번 연장할 때 늘어나는 기간 */
  EXTENSION_DAYS: 90,
  /** 연장 가능 횟수 */
  MAX_EXTENSIONS: 1,
  /** 만료 후 환불 비율. 남는 10% 는 수수료로 본다. */
  EXPIRED_REFUND_RATE: 0.9,
  FULL_REFUND_RATE: 1,
} as const;

/**
 * 저장되는 상태 4개.
 *
 * `draft`(결제 전)는 저장하지 않는다 — 보내기 시트를 닫으면 사라지는 화면 상태이고,
 * 저장하면 이어서 결제할 경로가 없는 죽은 레코드만 쌓인다.
 *
 * `expired` 도 저장하지 않는다. 만료는 사실이 아니라 계산이다: 교환권 만료 시각이
 * 지났으면 만료다. 안읽음 개수를 저장하지 않고 계산하는 것과 같은 이유로,
 * 저장해 두면 "만료로 바꿔주는 사람"이 필요해지고 그 사람이 없는 순간 틀어진다.
 *
 * `cancelled` 를 따로 두지 않는다 — 취소는 곧 환불이고, 다른 점은
 * "누가 시작했는지"라는 사유(`closedBy`)뿐이다.
 */
export type StoredGiftStatus = 'paid' | 'accepted' | 'used' | 'refunded';

/** 화면이 보는 상태. 저장 상태에 계산된 `expired` 가 더해진다. */
export type GiftStatus = StoredGiftStatus | 'expired';

export type GiftAction =
  | 'ACCEPT'
  | 'DECLINE'
  | 'CANCEL_BY_SENDER'
  | 'CANCEL_BY_RECEIVER'
  | 'USE'
  | 'EXTEND'
  | 'REFUND_EXPIRED'
  /** 데모용. 유효기간이 지나간 것으로 만들어 만료·환불 경로를 눌러볼 수 있게 한다. */
  | 'FORCE_EXPIRE';

/** 돈이 움직인 기록. 금액은 결제한 사람 기준으로 음수가 나감, 양수가 돌아옴. */
export interface GiftLedgerEntry {
  label: string;
  /** 언제나 결제한 사람이다. 환불금이 받는 사람에게 가지 않는다는 규칙이 여기 박혀 있다. */
  partyId: UserId;
  amount: number;
  note: string;
  at: number;
}

export interface GiftOrder {
  id: string;
  productId: string;
  senderId: UserId;
  receiverId: UserId;
  /** 선물 버블이 놓인 대화방. 선물은 언제나 대화 위에서 전달된다. */
  chatId: ChatId;
  /** 카드 메시지 */
  message: string;
  /** 결제 당시 가격. 상품 가격이 나중에 바뀌어도 정산은 이 값으로 한다. */
  price: number;
  status: StoredGiftStatus;
  paidAt: number;
  /** 수락·거절 시각 */
  respondedAt?: number;
  /** 교환권 만료 시각. 수락 이후에만 있다. */
  expiresAt?: number;
  extensionsUsed: number;
  usedAt?: number;
  /** 종료 사유. `refunded` 일 때만 있다. */
  closedBy?: string;
  refundAmount?: number;
  ledger: GiftLedgerEntry[];
}

export const newGiftOrder = (seed: {
  id: string;
  productId: string;
  senderId: UserId;
  receiverId: UserId;
  chatId: ChatId;
  message: string;
  price: number;
  at: number;
}): GiftOrder => ({
  id: seed.id,
  productId: seed.productId,
  senderId: seed.senderId,
  receiverId: seed.receiverId,
  chatId: seed.chatId,
  message: seed.message,
  price: seed.price,
  status: 'paid',
  paidAt: seed.at,
  extensionsUsed: 0,
  ledger: [
    {
      label: '결제',
      partyId: seed.senderId,
      amount: -seed.price,
      note: '모의 결제',
      at: seed.at,
    },
  ],
});

// ── 계산 ────────────────────────────────────────────────────────────────

/** 저장 상태 + 시간 = 화면이 보는 상태. */
export const giftStatus = (order: GiftOrder, now: number): GiftStatus =>
  order.status === 'accepted' && order.expiresAt !== undefined && order.expiresAt <= now
    ? 'expired'
    : order.status;

export const giftStatusLabel = (status: GiftStatus): string =>
  ({
    paid: '받는 사람 응답 대기',
    accepted: '사용중',
    used: '사용완료',
    expired: '기간만료',
    refunded: '환불완료',
  })[status];

/** 교환권 남은 날. 없거나 이미 지났으면 0. */
export const voucherDaysLeft = (order: GiftOrder, now: number): number => {
  if (order.expiresAt === undefined) return 0;
  return Math.max(0, Math.ceil((order.expiresAt - now) / DAY_MS));
};

export const isGiftClosed = (order: GiftOrder, now: number): boolean => {
  const st = giftStatus(order, now);
  return st === 'used' || st === 'refunded';
};

// ── 규칙 ────────────────────────────────────────────────────────────────

/**
 * 이 사람이 지금 이 동작을 할 수 있는가. 가능하면 null, 아니면 사람이 읽을 거절 이유.
 * 상태만 보는 게 아니라 **누가 하려는지**도 본다 — 선물의 소유권이 누구에게 있는지가
 * 이 모델의 핵심이라, 상태 검사와 당사자 검사를 나눠 두면 반쪽만 지켜진다.
 */
export const checkGiftAction = (
  order: GiftOrder,
  action: GiftAction,
  actorId: UserId,
  now: number,
): string | null => {
  const st = giftStatus(order, now);
  const isSender = actorId === order.senderId;
  const isReceiver = actorId === order.receiverId;
  if (!isSender && !isReceiver) return '이 선물의 당사자가 아닙니다.';

  switch (action) {
    case 'ACCEPT':
    case 'DECLINE':
      if (!isReceiver) return '받는 사람만 응답할 수 있습니다.';
      return st === 'paid' ? null : '이미 응답이 끝난 선물입니다.';

    case 'CANCEL_BY_SENDER':
      if (!isSender) return '보낸 사람만 취소할 수 있습니다.';
      if (st === 'accepted')
        return '받는 사람이 이미 받았습니다. 이 선물은 받는 사람 것이라 보낸 사람이 되돌릴 수 없습니다.';
      if (st === 'used') return '이미 사용된 선물은 취소할 수 없습니다.';
      if (st === 'expired') return '만료된 선물은 취소가 아니라 환불 대상입니다.';
      if (st === 'refunded') return '이미 종료된 선물입니다.';
      return null;

    case 'CANCEL_BY_RECEIVER':
      if (!isReceiver) return '받은 사람만 이 취소를 할 수 있습니다.';
      return st === 'accepted' ? null : '받은 상태의 선물만 취소할 수 있습니다.';

    case 'USE':
      if (!isReceiver) return '교환권은 받은 사람만 쓸 수 있습니다.';
      if (st === 'accepted') return null;
      if (st === 'expired') return '유효기간이 지난 교환권은 쓸 수 없습니다.';
      return '아직 교환권이 발급되지 않았습니다.';

    case 'EXTEND':
      if (!isReceiver) return '교환권은 받은 사람만 연장할 수 있습니다.';
      if (st === 'expired')
        return '이미 만료된 교환권은 연장할 수 없습니다. 남은 길은 환불뿐입니다.';
      if (st !== 'accepted') return '교환권이 없습니다.';
      if (order.extensionsUsed >= GIFT_RULES.MAX_EXTENSIONS)
        return `연장은 ${GIFT_RULES.MAX_EXTENSIONS}번까지만 가능합니다.`;
      return null;

    case 'REFUND_EXPIRED':
      if (!isSender) return '환불금은 결제한 사람에게 갑니다. 보낸 사람만 신청할 수 있습니다.';
      return st === 'expired' ? null : '만료된 선물만 이 방식으로 환불됩니다.';

    case 'FORCE_EXPIRE':
      return st === 'accepted' ? null : '유효한 교환권이 있을 때만 쓸 수 있는 데모 기능입니다.';
  }
};

export type GiftActionResult =
  | { ok: true; order: GiftOrder; text: string }
  | { ok: false; reason: string };

/** 다음 상태를 만든다. 입력 주문은 건드리지 않는다. */
export const applyGiftAction = (
  order: GiftOrder,
  action: GiftAction,
  actorId: UserId,
  now: number,
): GiftActionResult => {
  const refusal = checkGiftAction(order, action, actorId, now);
  if (refusal) return { ok: false, reason: refusal };

  const next: GiftOrder = { ...order, ledger: [...order.ledger] };
  const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

  /** 환불은 언제나 결제한 사람에게. 이 함수 하나만 쓰게 해서 규칙이 새지 않게 한다. */
  const settle = (rate: number, note: string, closedBy: string): number => {
    const amount = Math.round(next.price * rate);
    next.ledger.push({ label: '환불', partyId: next.senderId, amount, note, at: now });
    next.status = 'refunded';
    next.closedBy = closedBy;
    next.refundAmount = amount;
    delete next.expiresAt;
    return amount;
  };

  switch (action) {
    case 'ACCEPT':
      next.status = 'accepted';
      next.respondedAt = now;
      next.expiresAt = now + GIFT_RULES.VOUCHER_DAYS * DAY_MS;
      return {
        ok: true,
        order: next,
        text: `선물을 받았습니다. 유효기간 ${GIFT_RULES.VOUCHER_DAYS}일 교환권이 발급되고, 이 선물의 주인이 받는 사람으로 넘어갑니다.`,
      };

    case 'DECLINE': {
      next.respondedAt = now;
      const amount = settle(GIFT_RULES.FULL_REFUND_RATE, '받는 사람 거절 · 전액', '받는 사람 거절');
      return { ok: true, order: next, text: `거절했습니다. ${won(amount)}이 전액 보낸 사람에게 돌아갑니다.` };
    }

    case 'CANCEL_BY_SENDER': {
      const amount = settle(GIFT_RULES.FULL_REFUND_RATE, '보낸 사람 취소 · 전액', '보낸 사람 취소');
      return {
        ok: true,
        order: next,
        text: `아직 받는 사람이 받지 않았으므로 취소됩니다. ${won(amount)} 전액이 돌아갑니다.`,
      };
    }

    case 'CANCEL_BY_RECEIVER': {
      const amount = settle(
        GIFT_RULES.FULL_REFUND_RATE,
        '받는 사람이 받은 선물 취소 · 전액',
        '받는 사람 취소',
      );
      return {
        ok: true,
        order: next,
        text: `받은 선물을 취소했습니다. ${won(amount)}은 받은 사람이 아니라 결제한 사람에게 돌아갑니다 — 받는 사람은 취소를 결정할 수만 있고 현금을 가져갈 수는 없습니다.`,
      };
    }

    case 'USE':
      next.status = 'used';
      next.usedAt = now;
      next.closedBy = '매장 사용';
      return {
        ok: true,
        order: next,
        text: '교환권을 사용했습니다. 여기서 이 선물의 생애가 끝나고, 이후 환불은 불가능합니다.',
      };

    case 'EXTEND':
      next.extensionsUsed += 1;
      next.expiresAt = (order.expiresAt ?? now) + GIFT_RULES.EXTENSION_DAYS * DAY_MS;
      return {
        ok: true,
        order: next,
        text: `유효기간을 ${GIFT_RULES.EXTENSION_DAYS}일 연장했습니다. 연장은 ${GIFT_RULES.MAX_EXTENSIONS}번까지만 가능합니다.`,
      };

    case 'REFUND_EXPIRED': {
      const rate = GIFT_RULES.EXPIRED_REFUND_RATE;
      const amount = settle(rate, `만료 환불 · ${Math.round(rate * 100)}%`, '기간만료 환불');
      return {
        ok: true,
        order: next,
        text: `만료된 선물을 환불했습니다. ${won(amount)}이 돌아가고 ${won(next.price - amount)}은 수수료로 남습니다.`,
      };
    }

    case 'FORCE_EXPIRE':
      next.expiresAt = now - 1;
      return { ok: true, order: next, text: '데모: 유효기간이 지나간 것으로 만들었습니다.' };
  }
};

// ── 셀렉터 ──────────────────────────────────────────────────────────────

export const giftOrderById = (db: Db, id: string): GiftOrder | undefined =>
  db.giftOrders.find((o) => o.id === id);

const byNewest = (a: GiftOrder, b: GiftOrder): number => b.paidAt - a.paidAt;

export const receivedGifts = (db: Db, userId: UserId): GiftOrder[] =>
  db.giftOrders.filter((o) => o.receiverId === userId).sort(byNewest);

export const sentGifts = (db: Db, userId: UserId): GiftOrder[] =>
  db.giftOrders.filter((o) => o.senderId === userId).sort(byNewest);

/** 지금 쓸 수 있는 선물. 선물함 헤더의 "N개 있어요" 가 이 값이다. */
export const usableGifts = (db: Db, userId: UserId, now: number): GiftOrder[] =>
  receivedGifts(db, userId).filter((o) => giftStatus(o, now) === 'accepted');

/** 아직 응답하지 않은 받은 선물. 탭 배지의 근거. */
export const pendingGifts = (db: Db, userId: UserId, now: number): GiftOrder[] =>
  receivedGifts(db, userId).filter((o) => giftStatus(o, now) === 'paid');

export const finishedGifts = (db: Db, userId: UserId, now: number): GiftOrder[] =>
  receivedGifts(db, userId).filter((o) => {
    const st = giftStatus(o, now);
    return st === 'used' || st === 'expired' || st === 'refunded';
  });
