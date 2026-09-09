import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository, type KeyValueStore } from './localRepository';
import { messagesOf } from '../domain/selectors';
import { giftOrderById, receivedGifts, usableGifts } from '../domain/gift';
import { productById } from '../domain/products';

class MemoryStore implements KeyValueStore {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

const make = (store: KeyValueStore) => new LocalRepository(store, { broadcast: false });

const PRODUCT = 'p-americano';

describe('sendGift', () => {
  let repo: LocalRepository;
  let sender: string;
  let receiver: string;

  beforeEach(() => {
    repo = make(new MemoryStore());
    sender = repo.createUser('보낸이').id;
    receiver = repo.createUser('받는이').id;
  });

  it('1:1 방을 열고 그 방에 선물 메시지를 남긴다', () => {
    const result = repo.sendGift({
      senderId: sender,
      receiverId: receiver,
      productId: PRODUCT,
      message: '커피 한 잔 해',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const messages = messagesOf(repo.snapshot(), result.chatId);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.kind).toBe('gift');
    expect(messages[0]?.giftOrderId).toBe(result.orderId);
    // 버블을 못 그리는 화면에서도 뜻이 통하도록 텍스트가 채워져 있다.
    expect(messages[0]?.text).toContain('선물');
  });

  it('이미 대화 중이면 새 방을 만들지 않는다', () => {
    const chatId = repo.openDirectChat(sender, receiver);
    repo.sendMessage(chatId, sender, '안녕');

    const result = repo.sendGift({
      senderId: sender,
      receiverId: receiver,
      productId: PRODUCT,
      message: '',
    });
    expect(result.ok && result.chatId).toBe(chatId);
    expect(repo.snapshot().chats).toHaveLength(1);
  });

  it('결제 당시 가격을 주문에 박아둔다', () => {
    const result = repo.sendGift({
      senderId: sender,
      receiverId: receiver,
      productId: PRODUCT,
      message: '',
    });
    if (!result.ok) throw new Error('보내기 실패');
    const order = giftOrderById(repo.snapshot(), result.orderId);
    expect(order?.price).toBe(productById(PRODUCT)?.price);
  });

  it('자기 자신에게는 보낼 수 없다', () => {
    const r = repo.sendGift({
      senderId: sender,
      receiverId: sender,
      productId: PRODUCT,
      message: '',
    });
    expect(r).toEqual({ ok: false, reason: '자기 자신에게는 선물할 수 없습니다.' });
    expect(repo.snapshot().giftOrders).toHaveLength(0);
  });

  it('없는 상품은 거부한다', () => {
    const r = repo.sendGift({
      senderId: sender,
      receiverId: receiver,
      productId: 'p-does-not-exist',
      message: '',
    });
    expect(r.ok).toBe(false);
    expect(repo.snapshot().giftOrders).toHaveLength(0);
  });
});

describe('giftAction', () => {
  let repo: LocalRepository;
  let sender: string;
  let receiver: string;
  let orderId: string;

  beforeEach(() => {
    repo = make(new MemoryStore());
    sender = repo.createUser('보낸이').id;
    receiver = repo.createUser('받는이').id;
    const r = repo.sendGift({
      senderId: sender,
      receiverId: receiver,
      productId: PRODUCT,
      message: '',
    });
    if (!r.ok) throw new Error('보내기 실패');
    orderId = r.orderId;
  });

  it('수락하면 선물함의 사용 가능 목록에 들어간다', () => {
    expect(usableGifts(repo.snapshot(), receiver, Date.now())).toHaveLength(0);
    expect(repo.giftAction(orderId, receiver, 'ACCEPT').ok).toBe(true);
    expect(usableGifts(repo.snapshot(), receiver, Date.now())).toHaveLength(1);
    expect(receivedGifts(repo.snapshot(), receiver)).toHaveLength(1);
  });

  it('거절된 동작은 저장소를 바꾸지 않는다', () => {
    const before = JSON.stringify(repo.snapshot());
    const r = repo.giftAction(orderId, sender, 'ACCEPT'); // 보낸 사람은 수락할 수 없다
    expect(r.ok).toBe(false);
    expect(JSON.stringify(repo.snapshot())).toBe(before);
  });

  it('없는 주문은 사유를 돌려준다', () => {
    expect(repo.giftAction('nope', receiver, 'ACCEPT')).toEqual({
      ok: false,
      reason: '선물을 찾을 수 없습니다.',
    });
  });

  it('두 탭이 같은 세계를 본다 — 한쪽이 수락하면 다른 쪽도 안다', () => {
    const store = new MemoryStore();
    const tabA = make(store);
    const a = tabA.createUser('가').id;
    const b = tabA.createUser('나').id;
    const sent = tabA.sendGift({ senderId: a, receiverId: b, productId: PRODUCT, message: '' });
    if (!sent.ok) throw new Error('보내기 실패');

    // 같은 저장소를 보는 두 번째 인스턴스 = 두 번째 탭
    const tabB = make(store);
    expect(tabB.giftAction(sent.orderId, b, 'ACCEPT').ok).toBe(true);

    // 첫 탭도 같은 저장소를 다시 읽으면 수락된 것을 본다.
    const seenByA = make(store);
    expect(giftOrderById(seenByA.snapshot(), sent.orderId)?.status).toBe('accepted');
  });

  it('초기화하면 선물도 함께 사라진다', () => {
    repo.giftAction(orderId, receiver, 'ACCEPT');
    expect(repo.snapshot().giftOrders).toHaveLength(1);
    repo.reset();
    expect(repo.snapshot().giftOrders).toHaveLength(0);
  });
});
