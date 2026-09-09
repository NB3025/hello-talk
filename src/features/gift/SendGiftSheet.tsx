import { useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Avatar } from '../../ui/Avatar';
import { useStore } from '../../store/StoreProvider';
import { friendsOf, userById } from '../../domain/selectors';
import { wonLabel, type Product } from '../../domain/products';
import { GIFT_RULES } from '../../domain/gift';
import type { User, UserId } from '../../domain/types';

/**
 * 상품을 고른 다음의 마지막 관문. 받는 사람이 아직 없으면 여기서 고른다 —
 * 홈에서 사람을 먼저 골랐든 상품을 먼저 골랐든, 보내기 직전에는 반드시 사람이 있다.
 */
export function SendGiftSheet({
  me,
  product,
  recipientId,
  onPickRecipient,
  onClose,
  onSent,
}: {
  me: User;
  product: Product;
  recipientId: UserId | null;
  onPickRecipient: (id: UserId) => void;
  onClose: () => void;
  onSent: (chatId: string, text: string) => void;
}) {
  const { db, repo } = useStore();
  const friends = friendsOf(db, me.id);
  const recipient = recipientId ? userById(db, recipientId) : undefined;
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const send = () => {
    if (!recipient) {
      setError('받는 사람을 먼저 고르세요.');
      return;
    }
    const result = repo.sendGift({
      senderId: me.id,
      receiverId: recipient.id,
      productId: product.id,
      message,
    });
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    onSent(
      result.chatId,
      `${recipient.name} 님에게 선물을 보냈습니다. 대화방에 선물 카드가 전달되었고, 받으면 유효기간 ${GIFT_RULES.VOUCHER_DAYS}일 교환권이 발급됩니다.`,
    );
  };

  return (
    <Sheet title={product.name} lead={product.brand} onClose={onClose}>
      <div className="pad">
        <div className="pdetail" style={{ background: product.tint }}>
          <span className="glyph" aria-hidden="true">
            {product.glyph}
          </span>
          <span className="amt">{wonLabel(product.price)}</span>
        </div>
        <div className="chips" style={{ padding: '10px 0 0' }}>
          {product.freeShipping ? <span>무료배송</span> : null}
          {product.giftWrap ? <span>선물포장</span> : null}
          <span>♡ {product.likes.toLocaleString('ko-KR')}</span>
        </div>
      </div>

      <div className="section">
        <b>받는 사람</b>
      </div>

      {friends.length === 0 ? (
        <p className="note bad">
          친구가 없어 보낼 대상이 없습니다. 친구 탭에서 코드로 친구를 먼저 등록하세요.
        </p>
      ) : (
        <div className="whoscroll tight">
          {friends.map((f) => (
            <button
              key={f.id}
              className={recipientId === f.id ? 'whochip on' : 'whochip'}
              onClick={() => {
                onPickRecipient(f.id);
                setError(null);
              }}
              aria-pressed={recipientId === f.id}
            >
              <Avatar user={f} size={30} />
              {f.name}
            </button>
          ))}
        </div>
      )}

      <label className="field plain" style={{ paddingTop: 14 }}>
        <span className="label">카드 메시지 (선택)</span>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="생일 축하해! 커피 한 잔 해"
          maxLength={80}
        />
      </label>

      {error ? <p className="note bad">{error}</p> : null}

      <p className="note">
        결제는 <b>모의</b>입니다. 실제로 돈이 움직이지 않고, 대신 주문에 정산 기록만 남습니다.
        받는 사람이 수락하기 전까지는 보낸 사람이 취소할 수 있고, 수락한 뒤에는 선물의 주인이
        받는 사람으로 넘어가 보낸 사람이 되돌릴 수 없습니다.
      </p>

      <div className="actionsrow">
        <button className="pill ghost" onClick={onClose}>
          닫기
        </button>
        <button className="pill solid" onClick={send} disabled={friends.length === 0}>
          {wonLabel(product.price)} 결제하고 보내기
        </button>
      </div>
    </Sheet>
  );
}
