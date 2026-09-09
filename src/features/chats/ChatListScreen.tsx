import { Avatar } from '../../ui/Avatar';
import { useStore } from '../../store/StoreProvider';
import { chatsOf, chatTitle, counterpartsOf, lastMessage, unreadCount } from '../../domain/selectors';
import type { ChatId, User } from '../../domain/types';
import { listTimeLabel } from '../../ui/time';

export function ChatListScreen({
  me,
  onOpen,
  onGoFriends,
}: {
  me: User;
  onOpen: (chatId: ChatId) => void;
  onGoFriends: () => void;
}) {
  const { db } = useStore();
  const chats = chatsOf(db, me.id);
  const unreadTotal = chats.reduce((n, c) => n + unreadCount(db, c.id, me.id), 0);

  return (
    <>
      <div className="topbar">
        <h1>채팅</h1>
        <div className="actions">
          <button className="iconbtn" onClick={onGoFriends} aria-label="새 대화 시작">
            ✏
          </button>
        </div>
      </div>

      <div className="screen">
        {unreadTotal > 0 ? (
          <div className="section">
            <b>안읽음</b> {unreadTotal}
          </div>
        ) : null}

        {chats.length === 0 ? (
          <div className="empty">
            <b>대화가 없습니다</b>
            친구 탭에서 상대를 고르고 1:1 채팅을 시작하세요.
            <div style={{ marginTop: 16 }}>
              <button className="pill solid" onClick={onGoFriends}>
                친구 목록으로
              </button>
            </div>
          </div>
        ) : (
          chats.map((chat) => {
            const last = lastMessage(db, chat.id);
            const unread = unreadCount(db, chat.id, me.id);
            const others = counterpartsOf(db, chat, me.id);
            const face = others[0] ?? me;
            return (
              <button className="row" key={chat.id} onClick={() => onOpen(chat.id)}>
                <Avatar user={face} />
                <div className="body">
                  <div className="name">
                    {chatTitle(db, chat, me.id)}
                    {chat.memberIds.length > 2 ? (
                      <em style={{ fontStyle: 'normal', color: '#a8a8ad', fontSize: 13 }}>
                        {chat.memberIds.length}
                      </em>
                    ) : null}
                  </div>
                  <div className="sub">
                    {last
                      ? `${last.senderId === me.id ? '나: ' : ''}${last.text}`
                      : '아직 메시지가 없습니다'}
                  </div>
                </div>
                <div className="meta">
                  {last ? <span className="time">{listTimeLabel(last.createdAt)}</span> : null}
                  {unread > 0 ? <span className="badge">{unread > 99 ? '99+' : unread}</span> : null}
                </div>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}
