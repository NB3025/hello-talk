import { Avatar } from '../../ui/Avatar';
import { useStore } from '../../store/StoreProvider';
import { receivedGifts, sentGifts, usableGifts } from '../../domain/gift';
import { wonLabel } from '../../domain/products';
import type { User } from '../../domain/types';

/**
 * 레퍼런스 선물함 마이페이지 (`references/gift/NOTES.md` 4번 화면).
 * 구현하지 않은 항목은 지우지 않고 남겨 두되 "이번 범위 밖"임을 명시한다 —
 * 레퍼런스에 있는 목록의 모양이 정보 계층의 일부다.
 */
export function GiftMyPage({
  me,
  onGoBox,
  onGoSent,
}: {
  me: User;
  onGoBox: () => void;
  onGoSent: () => void;
}) {
  const { db } = useStore();
  const now = Date.now();
  const received = receivedGifts(db, me.id);
  const sent = sentGifts(db, me.id);
  const usable = usableGifts(db, me.id, now);
  const spent = sent.reduce((sum, o) => sum + o.price - (o.refundAmount ?? 0), 0);

  return (
    <>
      <div className="mycard">
        <Avatar user={me} size={52} />
        <div className="body">
          <div className="nm">{me.name}</div>
          <div className="st">{me.code}</div>
        </div>
      </div>

      <div className="shortcuts">
        <button onClick={onGoBox}>
          <span className="ic" aria-hidden="true">
            🎁
          </span>
          받은 선물
          <b>{received.length}</b>
        </button>
        <button onClick={onGoBox}>
          <span className="ic" aria-hidden="true">
            🎟
          </span>
          사용 가능
          <b>{usable.length}</b>
        </button>
        <button onClick={onGoSent}>
          <span className="ic" aria-hidden="true">
            📤
          </span>
          보낸 선물
          <b>{sent.length}</b>
        </button>
        <button onClick={onGoSent}>
          <span className="ic" aria-hidden="true">
            🧾
          </span>
          결제 합계
          <b>{spent > 0 ? wonLabel(spent) : '0원'}</b>
        </button>
      </div>

      <div className="divider" />

      <div className="section">
        <b>My 선물하기</b>
      </div>
      <button className="row" onClick={onGoSent}>
        <div className="avatar sq">🧾</div>
        <div className="body">
          <div className="name">주문내역</div>
          <div className="sub">보낸 선물 {sent.length}건 · 환불 포함</div>
        </div>
      </button>
      <button className="row" onClick={onGoBox}>
        <div className="avatar sq">🎟</div>
        <div className="body">
          <div className="name">받은 선물함</div>
          <div className="sub">사용 가능 {usable.length}개</div>
        </div>
      </button>
      <div className="row muted">
        <div className="avatar sq">💗</div>
        <div className="body">
          <div className="name">친구의 위시리스트</div>
          <div className="sub">위시 모델이 없어 이번 범위 밖입니다</div>
        </div>
      </div>
      <div className="row muted">
        <div className="avatar sq">📅</div>
        <div className="body">
          <div className="name">친구의 기념일</div>
          <div className="sub">캘린더 슬라이스에서 연결합니다</div>
        </div>
      </div>

      <p className="note">
        레퍼런스의 마이페이지에 <b>친구의 기념일</b>이 있습니다. 생일에서 선물로 이어지는 경로가
        선물하기 안쪽에도 한 번 더 있다는 뜻이라, 다음 캘린더 슬라이스가 이 자리에 붙습니다.
      </p>
    </>
  );
}
