import { Avatar } from '../../ui/Avatar';
import { Sheet } from '../../ui/Sheet';
import { useStore } from '../../store/StoreProvider';
import type { User } from '../../domain/types';

/**
 * B안에서 이 시트가 "사람에게 할 수 있는 일" 전부의 집이다.
 * 선물하기는 여기서 시작한다 — 최상위 탭을 만들지 않는 것이 B안의 주장이고,
 * 열리는 화면이 전체 화면이든 시트든 **진입이 사람에 붙어 있다**는 점이 핵심이다.
 */
export function FriendSheet({
  me,
  friend,
  onClose,
  onOpenChat,
  onOpenGift,
}: {
  me: User;
  friend: User;
  onClose: () => void;
  onOpenChat: (friend: User) => void;
  onOpenGift: (friend: User) => void;
}) {
  const { db, repo } = useStore();
  const favorite = db.friendships.some(
    (f) => f.ownerId === me.id && f.friendId === friend.id && f.favorite,
  );

  return (
    <Sheet title={friend.name} lead={friend.statusMessage || friend.code} onClose={onClose}>
      <div className="pad" style={{ display: 'flex', justifyContent: 'center', paddingBottom: 14 }}>
        <Avatar user={friend} size={72} />
      </div>

      <div className="actionsrow">
        <button className="pill solid" onClick={() => onOpenChat(friend)}>
          1:1 채팅
        </button>
        <button className="pill" onClick={() => repo.toggleFavorite(me.id, friend.id)}>
          {favorite ? '즐겨찾기 해제' : '즐겨찾기'}
        </button>
      </div>

      <div className="actionsrow">
        <button className="pill solid" onClick={() => onOpenGift(friend)}>
          🎁 선물하기
        </button>
        <button className="pill" disabled title="캘린더 슬라이스에서 구현합니다">
          📅 약속 잡기
        </button>
      </div>

      <p className="note">
        선물하기는 B안대로 <b>이 자리</b>에서 시작합니다 — 별도 탭을 만들지 않고 사람에 붙이는
        것이 B안의 전제입니다. 열리는 선물하기 화면은 실제 카카오톡처럼 자체 탭을 가진 전체 화면
        이고, {friend.name} 님이 받는 사람으로 미리 선택됩니다. 약속 잡기는 다음 슬라이스입니다.
      </p>

      <div className="actionsrow">
        <button
          className="pill ghost"
          onClick={() => {
            repo.removeFriend(me.id, friend.id);
            onClose();
          }}
        >
          친구 목록에서 삭제
        </button>
      </div>
    </Sheet>
  );
}
