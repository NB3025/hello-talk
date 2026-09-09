import { useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { useStore } from '../../store/StoreProvider';
import { userById } from '../../domain/selectors';
import {
  checkGiftAction,
  giftOrderById,
  giftStatus,
  giftStatusLabel,
  voucherDaysLeft,
  type GiftAction,
} from '../../domain/gift';
import { productById, wonLabel } from '../../domain/products';
import type { User } from '../../domain/types';
import { stampDate } from './GiftBox';

/** 보낸 사람에게만, 받는 사람에게만 보여야 하는 동작이 갈린다. */
const RECEIVER_ACTIONS: Array<{ action: GiftAction; label: string }> = [
  { action: 'ACCEPT', label: '선물 받기' },
  { action: 'DECLINE', label: '거절하기' },
  { action: 'USE', label: '교환권 사용' },
  { action: 'EXTEND', label: '유효기간 90일 연장' },
  { action: 'CANCEL_BY_RECEIVER', label: '받은 선물 취소' },
];

const SENDER_ACTIONS: Array<{ action: GiftAction; label: string }> = [
  { action: 'CANCEL_BY_SENDER', label: '보낸 선물 취소' },
  { action: 'REFUND_EXPIRED', label: '만료 선물 환불받기' },
];

export function VoucherSheet({
  me,
  orderId,
  onClose,
}: {
  me: User;
  orderId: string;
  onClose: () => void;
}) {
  const { db, repo } = useStore();
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);

  const order = giftOrderById(db, orderId);
  if (!order) {
    return (
      <Sheet title="선물" onClose={onClose}>
        <p className="note bad">선물을 찾을 수 없습니다. 초기화되었을 수 있습니다.</p>
      </Sheet>
    );
  }

  const now = Date.now();
  const product = productById(order.productId);
  const status = giftStatus(order, now);
  const amIReceiver = order.receiverId === me.id;
  const sender = userById(db, order.senderId);
  const receiver = userById(db, order.receiverId);
  const candidates = amIReceiver ? RECEIVER_ACTIONS : SENDER_ACTIONS;

  const run = (action: GiftAction) => {
    const result = repo.giftAction(order.id, me.id, action);
    setFlash(result.ok ? { ok: true, text: result.text } : { ok: false, text: result.reason });
  };

  return (
    <Sheet
      title={product?.name ?? '선물'}
      lead={`${product?.brand ?? ''} · ${giftStatusLabel(status)}`}
      onClose={onClose}
    >
      <div className="pad">
        <div className="pdetail" style={{ background: product?.tint }}>
          <span className="glyph" aria-hidden="true">
            {product?.glyph ?? '🎁'}
          </span>
          <span className="amt">{wonLabel(order.price)}</span>
          <span className={`stamp ${status === 'accepted' ? 'live' : 'dead'}`}>
            {giftStatusLabel(status)}
          </span>
        </div>
      </div>

      <dl className="factlist">
        <div>
          <dt>보낸 사람</dt>
          <dd>{sender?.name ?? '알 수 없음'}</dd>
        </div>
        <div>
          <dt>받는 사람</dt>
          <dd>{receiver?.name ?? '알 수 없음'}</dd>
        </div>
        <div>
          <dt>결제</dt>
          <dd>{stampDate(order.paidAt)}</dd>
        </div>
        {order.message ? (
          <div>
            <dt>카드 메시지</dt>
            <dd>{order.message}</dd>
          </div>
        ) : null}
        {status === 'accepted' ? (
          <div>
            <dt>유효기간</dt>
            <dd>
              {voucherDaysLeft(order, now)}일 남음
              {order.extensionsUsed > 0 ? ` · ${order.extensionsUsed}회 연장함` : ''}
            </dd>
          </div>
        ) : null}
        {order.closedBy ? (
          <div>
            <dt>종료 사유</dt>
            <dd>
              {order.closedBy}
              {order.refundAmount !== undefined ? ` · ${wonLabel(order.refundAmount)} 환불` : ''}
            </dd>
          </div>
        ) : null}
      </dl>

      {flash ? <p className={flash.ok ? 'note good' : 'note bad'}>{flash.text}</p> : null}

      {/* 버튼의 비활성 이유와 실제 거절 이유가 같은 문장이다 — 규칙이 도메인에만 있다. */}
      <div className="actionstack">
        {candidates.map(({ action, label }) => {
          const refusal = checkGiftAction(order, action, me.id, now);
          return (
            <button
              key={action}
              className={refusal ? 'pill' : 'pill solid'}
              disabled={Boolean(refusal)}
              title={refusal ?? undefined}
              onClick={() => run(action)}
            >
              {label}
              {refusal ? <span className="why">{refusal}</span> : null}
            </button>
          );
        })}
      </div>

      {order.ledger.length > 0 ? (
        <>
          <div className="section">
            <b>정산</b>
            <span className="right">결제한 사람 기준</span>
          </div>
          <div className="ledger">
            {order.ledger.map((e, i) => (
              <div key={i}>
                <span className="lb">{e.label}</span>
                <span className="ln">{e.note}</span>
                <span className={e.amount < 0 ? 'la out' : 'la in'}>
                  {e.amount < 0 ? '−' : '+'}
                  {wonLabel(Math.abs(e.amount))}
                </span>
              </div>
            ))}
          </div>
          <p className="note">
            환불금은 언제나 <b>결제한 사람</b>에게 갑니다. 받는 사람은 취소를 결정할 수만 있고
            현금을 가져갈 수는 없습니다.
          </p>
        </>
      ) : null}

      {amIReceiver && status === 'accepted' ? (
        <div className="actionsrow">
          <button className="pill ghost" onClick={() => run('FORCE_EXPIRE')}>
            데모: 유효기간이 지난 것으로 하기
          </button>
        </div>
      ) : null}
    </Sheet>
  );
}
