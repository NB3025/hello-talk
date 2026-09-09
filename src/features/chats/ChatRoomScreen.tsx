import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Avatar } from '../../ui/Avatar';
import { useStore } from '../../store/StoreProvider';
import {
  chatTitle,
  counterpartsOf,
  lastReadAt,
  messagesOf,
  userById,
} from '../../domain/selectors';
import type { ChatId, User } from '../../domain/types';
import { clockLabel, dayLabel, sameDay } from '../../ui/time';
import { giftOrderById } from '../../domain/gift';
import { GiftBubble } from '../gift/GiftBubble';
import { VoucherSheet } from '../gift/VoucherSheet';

export function ChatRoomScreen({
  me,
  chatId,
  onBack,
}: {
  me: User;
  chatId: ChatId;
  onBack: () => void;
}) {
  const { db, repo } = useStore();
  const [draft, setDraft] = useState('');
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const chat = db.chats.find((c) => c.id === chatId);
  const messages = chat ? messagesOf(db, chat.id) : [];
  const others = chat ? counterpartsOf(db, chat, me.id) : [];

  // 상대가 이 방을 어디까지 읽었는지. 내 마지막 메시지에 '읽음'을 붙이는 근거.
  const othersReadAt = chat
    ? Math.min(...others.map((o) => lastReadAt(db, chat.id, o.id)), Number.POSITIVE_INFINITY)
    : 0;

  // 방을 보고 있는 동안은 계속 읽은 것으로 처리한다. 새 메시지가 와도 안읽음이 쌓이면 안 된다.
  //
  // 의존성에 chat 객체를 넣으면 안 된다: 저장소가 쓸 때마다 db 를 JSON 으로 다시 만들어
  // chat 의 참조가 매번 바뀌고, 그러면 이 effect 가 매 쓰기마다 재실행돼 markRead → 쓰기 →
  // 재실행 무한 루프가 된다(React #185). 값으로 비교되는 id 와 개수만 넣는다.
  useEffect(() => {
    repo.markRead(chatId, me.id);
  }, [chatId, me.id, repo, messages.length]);

  // 새 메시지가 붙으면 맨 아래로. 페인트 전에 옮겨야 깜빡이지 않는다.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, chatId]);

  if (!chat) {
    return (
      <>
        <div className="topbar">
          <button className="back" onClick={onBack} aria-label="뒤로">
            ‹
          </button>
          <span className="roomname">대화방</span>
        </div>
        <div className="screen">
          <div className="empty">
            <b>대화방을 찾을 수 없습니다</b>
            삭제되었거나 다른 계정의 대화방입니다.
          </div>
        </div>
      </>
    );
  }

  const send = () => {
    const text = draft;
    if (!text.trim()) return;
    repo.sendMessage(chat.id, me.id, text);
    setDraft('');
    box.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 로 보내고 Shift+Enter 로 줄바꿈 — 메신저의 관습.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      <div className="topbar">
        <button className="back" onClick={onBack} aria-label="뒤로">
          ‹
        </button>
        <span className="roomname">
          {chatTitle(db, chat, me.id)}
          {chat.memberIds.length > 2 ? (
            <span className="roomsub">{chat.memberIds.length}</span>
          ) : null}
        </span>
      </div>

      <div className="screen" ref={scroller}>
        <div className="room">
          {messages.length === 0 ? (
            <div className="daysep">
              <span>첫 메시지를 보내보세요</span>
            </div>
          ) : null}

          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const showDay = !prev || !sameDay(prev.createdAt, m.createdAt);
            const mine = m.senderId === me.id;
            const sender = userById(db, m.senderId);
            // 같은 사람이 연달아 보낸 경우 이름과 아바타를 반복하지 않는다.
            const grouped =
              Boolean(prev) &&
              prev?.senderId === m.senderId &&
              sameDay(prev.createdAt, m.createdAt);
            const next = messages[i + 1];
            // 시각은 같은 사람의 마지막 메시지에만 붙인다.
            const showTime =
              !next ||
              next.senderId !== m.senderId ||
              clockLabel(next.createdAt) !== clockLabel(m.createdAt);
            const read = mine && othersReadAt >= m.createdAt;
            // 선물 메시지는 주문에서 상태를 매번 읽는다 — 굳혀 두면 수락해도 버블이 안 바뀐다.
            const giftOrder =
              m.kind === 'gift' && m.giftOrderId ? giftOrderById(db, m.giftOrderId) : undefined;

            return (
              <div key={m.id}>
                {showDay ? (
                  <div className="daysep">
                    <span>{dayLabel(m.createdAt)}</span>
                  </div>
                ) : null}
                <div className={mine ? 'msgrow mine' : 'msgrow'}>
                  {mine ? (
                    <div className="stamp">
                      {read ? <span>읽음</span> : null}
                      {showTime ? <span>{clockLabel(m.createdAt)}</span> : null}
                    </div>
                  ) : null}

                  {!mine && !grouped && sender ? <Avatar user={sender} size={34} /> : null}
                  {!mine && grouped ? <div style={{ flex: '0 0 34px' }} /> : null}

                  <div>
                    {!mine && !grouped && sender ? <div className="who">{sender.name}</div> : null}
                    {giftOrder ? (
                      <GiftBubble me={me} order={giftOrder} onOpen={setOpenOrder} />
                    ) : (
                      <div className="bubble">{m.text}</div>
                    )}
                  </div>

                  {!mine && showTime ? (
                    <div className="stamp">
                      <span>{clockLabel(m.createdAt)}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="composer">
        <textarea
          ref={box}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="메시지 입력"
          rows={1}
          aria-label="메시지 입력"
        />
        <button className="sendbtn" onClick={send} disabled={!draft.trim()}>
          전송
        </button>
      </div>

      {openOrder ? (
        <VoucherSheet me={me} orderId={openOrder} onClose={() => setOpenOrder(null)} />
      ) : null}
    </>
  );
}
