import { Avatar } from '../../ui/Avatar';
import { Sheet } from '../../ui/Sheet';
import { ComingSoonPill } from '../../ui/ComingSoon';
import { useStore } from '../../store/StoreProvider';
import { roadmapItem } from '../../domain/roadmap';
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
  const scheduleItem = roadmapItem('schedule-from-friend');

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
        {scheduleItem ? <ComingSoonPill item={scheduleItem} /> : null}
      </div>

      <p className="note">
        선물하기는 <b>이 자리</b>에서 시작합니다 — 별도 탭을 만들지 않고 사람에 붙이는 것이 이
        배치의 전제입니다. 열리는 선물하기 화면은 실제 카카오톡처럼 자체 탭을 가진 전체 화면이고,{' '}
        {friend.name} 님이 받는 사람으로 미리 선택됩니다. 일정도 같은 자리에서 시작할 예정입니다 —
        카카오톡도 "채팅방에서 빠르게 일정을 만드는 것"이 톡캘린더의 정의입니다.
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
