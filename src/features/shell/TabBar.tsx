export type TabId = 'friends' | 'chats' | 'open' | 'shop' | 'more';

/** B안의 전제: 탭은 5개 그대로. 선물·캘린더 탭을 추가하지 않는다. */
const TABS: Array<{ id: TabId; glyph: string; label: string }> = [
  { id: 'friends', glyph: '👤', label: '친구' },
  { id: 'chats', glyph: '💬', label: '채팅' },
  { id: 'open', glyph: '💭', label: '오픈채팅' },
  { id: 'shop', glyph: '🛍', label: '쇼핑' },
  { id: 'more', glyph: '⋯', label: '더보기' },
];

export function TabBar({
  current,
  unread,
  onChange,
}: {
  current: TabId;
  unread: number;
  onChange: (tab: TabId) => void;
}) {
  return (
    <nav className="tabbar" aria-label="주요 화면">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          aria-current={t.id === current}
          aria-label={t.label}
        >
          <span className="glyph" aria-hidden="true">
            {t.glyph}
          </span>
          {t.id === 'chats' && unread > 0 ? (
            <span className="tabbadge">{unread > 99 ? '99+' : unread}</span>
          ) : null}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
