import { useStore } from '../../store/StoreProvider';
import { giftStatus, giftStatusLabel, voucherDaysLeft, type GiftOrder } from '../../domain/gift';
import { productById, wonLabel } from '../../domain/products';
import type { User } from '../../domain/types';

/**
 * 대화방에 놓이는 선물 카드.
 *
 * 상태를 **저장된 텍스트로 굳히지 않고** 주문에서 매번 읽는다. 수락하면 이 버블이 바로
 * "사용중"으로 바뀐다 — 실제 카카오톡도 그렇고, 별도의 시스템 메시지를 추가로 흘리면
 * 대화가 지저분해진다.
 */
export function GiftBubble({
  me,
  order,
  onOpen,
}: {
  me: User;
  order: GiftOrder;
  onOpen: (orderId: string) => void;
}) {
  const { repo } = useStore();
  const now = Date.now();
  const product = productById(order.productId);
  const status = giftStatus(order, now);
  const amIReceiver = order.receiverId === me.id;

  return (
    <div className="giftbubble">
      <div className="gb-art" style={{ background: product?.tint }}>
        <span className="glyph" aria-hidden="true">
          {product?.glyph ?? '🎁'}
        </span>
        <span className="amt">{wonLabel(order.price)}</span>
      </div>

      <button className="gb-body" onClick={() => onOpen(order.id)}>
        <div className="gb-kicker">🎁 선물이 도착했어요</div>
        <div className="gb-brand">{product?.brand ?? '선물'}</div>
        <div className="gb-name">{product?.name ?? order.productId}</div>
        {order.message ? <div className="gb-msg">“{order.message}”</div> : null}
        <div className={`gb-state ${status}`}>
          {giftStatusLabel(status)}
          {status === 'accepted' ? ` · ${voucherDaysLeft(order, now)}일 남음` : null}
        </div>
      </button>

      {/* 받는 사람이 아직 응답하지 않았을 때만 인라인 버튼을 둔다. */}
      {amIReceiver && status === 'paid' ? (
        <div className="gb-actions">
          <button
            className="pill solid"
            onClick={() => repo.giftAction(order.id, me.id, 'ACCEPT')}
          >
            선물 받기
          </button>
          <button className="pill" onClick={() => repo.giftAction(order.id, me.id, 'DECLINE')}>
            거절
          </button>
        </div>
      ) : (
        <div className="gb-actions">
          <button className="pill" onClick={() => onOpen(order.id)}>
            선물 상세
          </button>
        </div>
      )}
    </div>
  );
}
