import { useState } from 'react';
import { useStore } from '../../store/StoreProvider';
import { userById } from '../../domain/selectors';
import {
  finishedGifts,
  giftStatus,
  giftStatusLabel,
  pendingGifts,
  receivedGifts,
  sentGifts,
  usableGifts,
  voucherDaysLeft,
  type GiftOrder,
  type GiftStatus,
} from '../../domain/gift';
import { productById, wonLabel } from '../../domain/products';
import type { User } from '../../domain/types';
import { clockLabel } from '../../ui/time';

/**
 * 레퍼런스 선물함 · 받은선물 (`references/gift/NOTES.md` 3번 화면).
 *
 * 헤더가 "사용할 수 있는 선물이 N개 있어요"인 것을 그대로 가져왔다 — 숫자를 라벨에
 * 붙이지 않고 문장에 넣는 표기다.
 */
export function GiftBox({ me, onOpenOrder }: { me: User; onOpenOrder: (id: string) => void }) {
  const { db } = useStore();
  const now = Date.now();
  const [tab, setTab] = useState<'received' | 'done' | 'sent'>('received');

  const usable = usableGifts(db, me.id, now);
  const pending = pendingGifts(db, me.id, now);
  const done = finishedGifts(db, me.id, now);
  const sent = sentGifts(db, me.id);
  const received = receivedGifts(db, me.id).filter((o) => {
    const st = giftStatus(o, now);
    return st === 'paid' || st === 'accepted';
  });

  const list = tab === 'received' ? received : tab === 'done' ? done : sent;

  return (
    <>
      <div className="boxhead">
        <h2>
          {usable.length > 0
            ? `사용할 수 있는 선물이 ${usable.length}개 있어요`
            : pending.length > 0
              ? `응답을 기다리는 선물이 ${pending.length}개 있어요`
              : '아직 받은 선물이 없어요'}
        </h2>
      </div>

      <div className="boxtabs" role="tablist" aria-label="선물함">
        {(
          [
            ['received', '받은선물', received.length],
            ['done', '사용완료', done.length],
            ['sent', '보낸선물', sent.length],
          ] as const
        ).map(([id, label, count]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'on' : ''}
            onClick={() => setTab(id)}
          >
            {label} {count > 0 ? <b>{count}</b> : null}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="empty">
          <b>{tab === 'sent' ? '보낸 선물이 없습니다' : '선물이 없습니다'}</b>
          {tab === 'sent'
            ? '친구 프로필에서 🎁 선물하기를 눌러 보내보세요.'
            : '친구가 선물을 보내면 여기에 쌓입니다.'}
        </div>
      ) : (
        <div className="vgrid">
          {list.map((o) => (
            <VoucherCard key={o.id} me={me} order={o} now={now} onOpen={onOpenOrder} />
          ))}
        </div>
      )}
    </>
  );
}

/** 도장 색. 사용중은 초록, 끝난 것은 회색, 되돌아간 것은 빨강. */
const STAMP_TONE: Record<GiftStatus, string> = {
  paid: 'wait',
  accepted: 'live',
  used: 'done',
  expired: 'dead',
  refunded: 'dead',
};

export function VoucherCard({
  me,
  order,
  now,
  onOpen,
}: {
  me: User;
  order: GiftOrder;
  now: number;
  onOpen: (id: string) => void;
}) {
  const { db } = useStore();
  const product = productById(order.productId);
  const status = giftStatus(order, now);
  const mine = order.receiverId === me.id;
  const other = userById(db, mine ? order.senderId : order.receiverId);
  const days = voucherDaysLeft(order, now);

  return (
    <button className="vcard" onClick={() => onOpen(order.id)}>
      <div className="coupon" style={{ background: product?.tint }}>
        <span className="glyph" aria-hidden="true">
          {product?.glyph ?? '🎁'}
        </span>
        <span className="amt">{wonLabel(order.price)}</span>
        <span className={`stamp ${STAMP_TONE[status]}`}>{giftStatusLabel(status)}</span>
      </div>
      <div className="vbrand">{product?.brand ?? '알 수 없는 상품'}</div>
      <div className="vname">{product?.name ?? order.productId}</div>
      <div className="vfrom">
        {mine ? 'from.' : 'to.'}
        {other?.name ?? '알 수 없음'}
      </div>
      <div className="vwhen">
        {stampDate(order.paidAt)}
        {status === 'accepted' ? ` · ${days}일 남음` : null}
      </div>
    </button>
  );
}

/** 2024.02.14 오후 01:37 — 레퍼런스 카드의 표기를 따른다. */
export const stampDate = (at: number): string => {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${clockLabel(at)}`;
};
