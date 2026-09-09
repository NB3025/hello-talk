import { useState } from 'react';
import { useStore } from './store/StoreProvider';
import { totalUnread } from './domain/selectors';
import type { ChatId, User, UserId } from './domain/types';
import { LoginScreen } from './features/auth/LoginScreen';
import { FriendsScreen } from './features/friends/FriendsScreen';
import { ChatListScreen } from './features/chats/ChatListScreen';
import { ChatRoomScreen } from './features/chats/ChatRoomScreen';
import { MoreScreen } from './features/more/MoreScreen';
import { GiftApp, type GiftTab } from './features/gift/GiftApp';
import { TabBar, type TabId } from './features/shell/TabBar';

/** 선물하기는 탭이 아니라 셸 위에 얹히는 전체 화면이다. 열려 있는 동안의 상태. */
interface GiftOverlay {
  tab: GiftTab;
  recipientId: UserId | null;
}

export default function App() {
  const { db, me } = useStore();
  const [tab, setTab] = useState<TabId>('friends');
  const [openChat, setOpenChat] = useState<ChatId | null>(null);
  const [gift, setGift] = useState<GiftOverlay | null>(null);

  if (!me) {
    return (
      <div className="app">
        <LoginScreen />
      </div>
    );
  }

  // 선물하기가 열려 있으면 카카오톡 셸 전체를 덮는다 — 레퍼런스와 같다.
  if (gift) {
    return (
      <div className="app">
        <GiftApp
          me={me}
          initialTab={gift.tab}
          initialRecipientId={gift.recipientId}
          onClose={() => setGift(null)}
          onOpenChat={(chatId) => {
            setTab('chats');
            setOpenChat(chatId);
          }}
        />
      </div>
    );
  }

  // 대화방에 들어가면 탭바가 사라지고 입력창이 그 자리를 차지한다 — 카카오톡과 같다.
  if (openChat) {
    return (
      <div className="app">
        <ChatRoomScreen me={me} chatId={openChat} onBack={() => setOpenChat(null)} />
      </div>
    );
  }

  return (
    <div className="app">
      <TabScreen
        tab={tab}
        me={me}
        onOpenChat={setOpenChat}
        onGoFriends={() => setTab('friends')}
        onGoChats={() => setTab('chats')}
        onOpenGift={setGift}
      />
      <TabBar current={tab} unread={totalUnread(db, me.id)} onChange={setTab} />
    </div>
  );
}

function TabScreen({
  tab,
  me,
  onOpenChat,
  onGoFriends,
  onGoChats,
  onOpenGift,
}: {
  tab: TabId;
  me: User;
  onOpenChat: (id: ChatId) => void;
  onGoFriends: () => void;
  onGoChats: () => void;
  onOpenGift: (overlay: GiftOverlay) => void;
}) {
  const { repo } = useStore();

  switch (tab) {
    case 'friends':
      return (
        <FriendsScreen
          me={me}
          onOpenChatWith={(friend) => {
            const id = repo.openDirectChat(me.id, friend.id);
            onGoChats();
            onOpenChat(id);
          }}
          // B안의 진입점: 선물은 사람에서 시작한다. 받는 사람을 미리 채워 넘긴다.
          onOpenGiftFor={(friend) => onOpenGift({ tab: 'home', recipientId: friend.id })}
        />
      );
    case 'chats':
      return <ChatListScreen me={me} onOpen={onOpenChat} onGoFriends={onGoFriends} />;
    case 'more':
      return (
        <MoreScreen me={me} onOpenGift={(giftTab) => onOpenGift({ tab: giftTab, recipientId: null })} />
      );
    case 'open':
    case 'shop':
      return <Placeholder title={tab === 'open' ? '오픈채팅' : '쇼핑'} />;
  }
}

function Placeholder({ title }: { title: string }) {
  return (
    <>
      <div className="topbar">
        <h1>{title}</h1>
      </div>
      <div className="screen">
        <div className="empty">
          <b>이번 범위 밖입니다</b>
          {title} 은 셸의 자리만 잡아두었습니다. 지금까지의 범위는 친구 등록·채팅·선물하기입니다.
        </div>
      </div>
    </>
  );
}
