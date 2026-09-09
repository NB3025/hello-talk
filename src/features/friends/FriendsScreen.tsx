import { useState } from 'react';
import { Avatar } from '../../ui/Avatar';
import { useStore } from '../../store/StoreProvider';
import { addedMe, favoritesOf, friendsOf } from '../../domain/selectors';
import type { User } from '../../domain/types';
import { AddFriendSheet } from './AddFriendSheet';
import { FriendSheet } from './FriendSheet';

export function FriendsScreen({
  me,
  onOpenChatWith,
  onOpenGiftFor,
}: {
  me: User;
  onOpenChatWith: (friend: User) => void;
  onOpenGiftFor: (friend: User) => void;
}) {
  const { db, repo } = useStore();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<User | null>(null);
  const [copied, setCopied] = useState(false);

  const favorites = favoritesOf(db, me.id);
  const friends = friendsOf(db, me.id);
  const pending = addedMe(db, me.id);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(me.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 클립보드 권한이 없으면 조용히 지나간다 — 코드는 화면에 이미 보인다.
    }
  };

  return (
    <>
      <div className="topbar">
        <h1>친구</h1>
        <div className="actions">
          <button className="iconbtn" onClick={() => setAdding(true)} aria-label="친구 추가">
            ＋
          </button>
        </div>
      </div>

      <div className="screen">
        <div className="mecard">
          <Avatar user={me} size={54} />
          <div className="body">
            <div className="nm">{me.name}</div>
            {me.statusMessage ? <div className="st">{me.statusMessage}</div> : null}
            <button className="codechip" onClick={copyCode} aria-label="내 친구 코드 복사">
              <span className="k">내 코드</span>
              {me.code}
              <span className="k">{copied ? '복사됨' : '복사'}</span>
            </button>
          </div>
        </div>

        <div className="divider" />

        {pending.length > 0 ? (
          <>
            <div className="section">
              <b>나를 추가한 친구</b> {pending.length}
            </div>
            {pending.map((u) => (
              <div className="row" key={u.id}>
                <Avatar user={u} size={40} />
                <div className="body">
                  <div className="name">{u.name}</div>
                  <div className="sub">{u.code}</div>
                </div>
                <button className="pill solid" onClick={() => repo.addFriendByCode(me.id, u.code)}>
                  나도 추가
                </button>
              </div>
            ))}
            <div className="divider" />
          </>
        ) : null}

        {favorites.length > 0 ? (
          <>
            <div className="section">
              <b>즐겨찾기</b> {favorites.length}
            </div>
            {favorites.map((u) => (
              <FriendRow key={u.id} user={u} favorite onSelect={setSelected} />
            ))}
            <div className="divider" />
          </>
        ) : null}

        <div className="section">
          <b>친구</b> {friends.length}
          <span className="right">가나다순</span>
        </div>

        {friends.length === 0 ? (
          <div className="empty">
            <b>아직 친구가 없습니다</b>
            우측 상단 ＋ 를 눌러 상대의 친구 코드를 입력하세요.
            <br />내 코드 {me.code} 를 상대에게 알려줘도 됩니다.
          </div>
        ) : (
          friends.map((u) => (
            <FriendRow
              key={u.id}
              user={u}
              favorite={favorites.some((f) => f.id === u.id)}
              onSelect={setSelected}
            />
          ))
        )}
      </div>

      {adding ? <AddFriendSheet me={me} onClose={() => setAdding(false)} /> : null}
      {selected ? (
        <FriendSheet
          me={me}
          friend={selected}
          onClose={() => setSelected(null)}
          onOpenChat={(f) => {
            setSelected(null);
            onOpenChatWith(f);
          }}
          onOpenGift={(f) => {
            setSelected(null);
            onOpenGiftFor(f);
          }}
        />
      ) : null}
    </>
  );
}

function FriendRow({
  user,
  favorite,
  onSelect,
}: {
  user: User;
  favorite: boolean;
  onSelect: (u: User) => void;
}) {
  return (
    <button className="row" onClick={() => onSelect(user)}>
      <Avatar user={user} size={40} />
      <div className="body">
        <div className="name">
          {user.name}
          {favorite ? (
            <span className="star" aria-label="즐겨찾기">
              ★
            </span>
          ) : null}
        </div>
        {user.statusMessage ? <div className="sub">{user.statusMessage}</div> : null}
      </div>
    </button>
  );
}
