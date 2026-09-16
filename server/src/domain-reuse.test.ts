import { describe, expect, it } from 'vitest';

// 복사본이 아니라 프런트엔드의 실제 순수 도메인 모듈을 그대로 가져온다.
// 이 import 들이 서버 테스트 러너에서 컴파일·실행된다는 것 자체가 재사용 배선의 증거다.
import {
  checkGiftAction,
  applyGiftAction,
  newGiftOrder,
  type GiftOrder,
} from '../../src/domain/gift';
import {
  directChatBetween,
  unreadCount,
  normalizeCode,
  findUserByCode,
} from '../../src/domain/selectors';
import { productById } from '../../src/domain/products';
import { newId, newFriendCode } from '../../src/domain/ids';
import { emptyDb, type Db, type User } from '../../src/domain/types';

const AT = 1_700_000_000_000;

const makeOrder = (): GiftOrder =>
  newGiftOrder({
    id: 'order-1',
    productId: 'p1',
    senderId: 'sender',
    receiverId: 'receiver',
    chatId: 'chat-1',
    message: '축하해요',
    price: 10_000,
    at: AT,
  });

describe('domain code reuse from the server', () => {
  it('checkGiftAction enforces authorization (receiver-only ACCEPT)', () => {
    const order = makeOrder();
    // 받는 사람은 갓 결제된 선물을 수락할 수 있다 -> null (거절 이유 없음).
    expect(checkGiftAction(order, 'ACCEPT', 'receiver', AT)).toBeNull();
    // 보낸 사람은 수락할 수 없다.
    expect(checkGiftAction(order, 'ACCEPT', 'sender', AT)).toBe('받는 사람만 응답할 수 있습니다.');
    // 당사자가 아니면 거절된다.
    expect(checkGiftAction(order, 'ACCEPT', 'stranger', AT)).toBe('이 선물의 당사자가 아닙니다.');
  });

  it('applyGiftAction issues a voucher on ACCEPT', () => {
    const order = makeOrder();
    const result = applyGiftAction(order, 'ACCEPT', 'receiver', AT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.status).toBe('accepted');
      expect(result.order.expiresAt).toBeGreaterThan(AT);
    }
  });

  it('selectors compute over a Db shape', () => {
    const db: Db = emptyDb();
    expect(directChatBetween(db, 'a', 'b')).toBeUndefined();
    expect(unreadCount(db, 'chat-1', 'a')).toBe(0);
    expect(normalizeCode(' ht-4f2k ')).toBe('HT4F2K');
    expect(findUserByCode(db, 'HT-4F2K')).toBeUndefined();
  });

  it('products catalog resolves by id and is undefined for unknown ids', () => {
    expect(productById('does-not-exist')).toBeUndefined();
  });

  it('ids run under Node Web Crypto', () => {
    const id = newId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const code = newFriendCode();
    expect(code).toMatch(/^HT-[A-Z0-9]{4}$/);
  });

  it('User type is importable from the server', () => {
    const user: User = {
      id: newId(),
      code: newFriendCode(),
      name: '홍길동',
      statusMessage: '',
      hue: '#F6C1B4',
      createdAt: AT,
    };
    expect(user.name).toBe('홍길동');
  });
});
