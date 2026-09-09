import { useEffect, useState } from 'react';
import { useStore } from '../../store/StoreProvider';
import { pendingGifts, usableGifts } from '../../domain/gift';
import {
  CATEGORIES,
  PRODUCTS,
  productsOfCategory,
  THEMES,
  type CategoryId,
  type Product,
  type ThemeId,
} from '../../domain/products';
import type { ChatId, User, UserId } from '../../domain/types';
import { GiftHome, GiftRanking, GiftThemeView } from './GiftHome';
import { GiftBox } from './GiftBox';
import { GiftMyPage } from './GiftMyPage';
import { ProductGrid } from './ProductGrid';
import { SendGiftSheet } from './SendGiftSheet';
import { VoucherSheet } from './VoucherSheet';

/**
 * 선물하기는 **전체 화면 서브앱**이다 — 자기 상단바, 자기 스크롤 탭, 자기 하단 탭을
 * 가지고 카카오톡 셸 위에 얹힌다. 레퍼런스가 그렇고, 카탈로그를 시트 높이에 밀어넣으면
 * 2열 상품 그리드가 성립하지 않는다.
 *
 * B안을 버린 것이 아니다. B안의 주장은 **진입이 사람에서 온다**는 것이고 그건 그대로다:
 * 하단 탭은 여전히 5개이고, 이 화면은 친구 프로필 시트(🎁 선물하기)나 더보기 그리드에서만
 * 열린다. 열린 뒤의 표면 크기는 B안의 주장이 아니었다.
 *
 * 하단 탭은 레퍼런스의 5개(홈·카테고리·브랜드·위시·선물함) 중 4개다.
 * `브랜드` 는 광고 자리라 뺐고, `위시` 는 위시리스트 모델이 없어 뺐다.
 * 대신 레퍼런스 04번의 마이페이지를 `마이` 로 둔다.
 */
export type GiftTab = 'home' | 'category' | 'box' | 'my';

/** 상단 스크롤 탭. 레퍼런스는 홈·랭킹 다음에 시즌 테마를 붙인다. */
type TopTab = 'home' | 'ranking' | ThemeId;

const TOP_TABS: Array<{ id: TopTab; label: string; badge?: string }> = [
  { id: 'home', label: '홈' },
  { id: 'ranking', label: '랭킹' },
  { id: 'chuseok', label: '추석선물', badge: '특가' },
  { id: 'wine', label: '와인/위스키' },
  { id: 'luxury', label: '럭셔리선물' },
];

export function GiftApp({
  me,
  initialTab = 'home',
  initialRecipientId = null,
  onClose,
  onOpenChat,
}: {
  me: User;
  initialTab?: GiftTab;
  initialRecipientId?: UserId | null;
  onClose: () => void;
  onOpenChat: (chatId: ChatId) => void;
}) {
  const { db } = useStore();
  const [tab, setTab] = useState<GiftTab>(initialTab);
  const [topTab, setTopTab] = useState<TopTab>('home');
  const [recipientId, setRecipientId] = useState<UserId | null>(initialRecipientId);
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [openProduct, setOpenProduct] = useState<Product | null>(null);
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<{ chatId: ChatId; text: string } | null>(null);
  /** 최근 본 상품. 저장하지 않는다 — 세션 안에서만 의미 있는 목록이다. */
  const [recent, setRecent] = useState<Product[]>([]);

  const now = Date.now();
  const usable = usableGifts(db, me.id, now).length;
  const pending = pendingGifts(db, me.id, now).length;
  const boxBadge = usable + pending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !openProduct && !openOrder && !sentNote) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, openProduct, openOrder, sentNote]);

  const pickProduct = (p: Product) => {
    setRecent((prev) => [p, ...prev.filter((x) => x.id !== p.id)].slice(0, 8));
    setOpenProduct(p);
  };

  const themeTab = topTab !== 'home' && topTab !== 'ranking' ? topTab : null;

  return (
    <div className="giftapp" role="dialog" aria-modal="true" aria-label="선물하기">
      <div className="gtopbar">
        {themeTab || tab !== 'home' ? (
          <button
            className="back"
            aria-label="뒤로"
            onClick={() => {
              if (themeTab) setTopTab('home');
              else setTab('home');
            }}
          >
            ‹
          </button>
        ) : (
          <span className="back" aria-hidden="true" />
        )}
        <span className="gtitle">선물하기</span>
        <button className="iconbtn" aria-label="검색" title="이번 범위 밖입니다" disabled>
          🔍
        </button>
        <button className="iconbtn close" aria-label="선물하기 닫기" onClick={onClose}>
          ×
        </button>
      </div>

      {tab === 'home' ? (
        <div className="gscrolltabs" role="tablist" aria-label="선물하기 섹션">
          {TOP_TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={topTab === t.id}
              className={topTab === t.id ? 'on' : ''}
              onClick={() => setTopTab(t.id)}
            >
              {t.label}
              {t.badge ? <span className="tt">{t.badge}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="screen">
        {tab === 'home' && topTab === 'home' ? (
          <GiftHome
            me={me}
            recipientId={recipientId}
            onPickRecipient={setRecipientId}
            onPickTheme={setTopTab}
            onPickProduct={pickProduct}
            recentlyViewed={recent}
          />
        ) : null}

        {tab === 'home' && topTab === 'ranking' ? (
          <GiftRanking recipientId={recipientId} onPickProduct={pickProduct} />
        ) : null}

        {tab === 'home' && themeTab ? (
          <GiftThemeView theme={themeTab} onPickProduct={pickProduct} />
        ) : null}

        {tab === 'category' ? (
          <>
            <div className="section">
              <b>카테고리</b>
              <span className="right">{PRODUCTS.length}개 상품</span>
            </div>
            <div className="catlist">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  className={category === c.id ? 'catrow on' : 'catrow'}
                  onClick={() => setCategory(category === c.id ? null : c.id)}
                >
                  <span className="ic" aria-hidden="true">
                    {c.glyph}
                  </span>
                  {c.label}
                  <span className="n">{productsOfCategory(c.id).length}</span>
                </button>
              ))}
            </div>
            {category ? (
              <ProductGrid products={productsOfCategory(category)} onPick={pickProduct} />
            ) : (
              <div className="empty">
                <b>카테고리를 고르세요</b>
                테마로 찾고 싶으면 홈의 <b>선물 테마</b> 그리드를 쓰세요. 레퍼런스도 테마를 먼저
                보여줍니다 — 사람들은 상품이 아니라 상황으로 찾습니다.
              </div>
            )}
          </>
        ) : null}

        {tab === 'box' ? <GiftBox me={me} onOpenOrder={setOpenOrder} /> : null}

        {tab === 'my' ? (
          <GiftMyPage me={me} onGoBox={() => setTab('box')} onGoSent={() => setTab('box')} />
        ) : null}
      </div>

      <nav className="gtabbar" aria-label="선물하기 화면">
        {(
          [
            ['home', '🏠', '홈'],
            ['category', '▦', '카테고리'],
            ['box', '🎁', '선물함'],
            ['my', '👤', '마이'],
          ] as const
        ).map(([id, glyph, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-current={tab === id}
            aria-label={label}
          >
            <span className="glyph" aria-hidden="true">
              {glyph}
            </span>
            {id === 'box' && boxBadge > 0 ? <span className="tabbadge">{boxBadge}</span> : null}
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {openProduct ? (
        <SendGiftSheet
          me={me}
          product={openProduct}
          recipientId={recipientId}
          onPickRecipient={setRecipientId}
          onClose={() => setOpenProduct(null)}
          onSent={(chatId, text) => {
            setOpenProduct(null);
            setSentNote({ chatId, text });
          }}
        />
      ) : null}

      {openOrder ? (
        <VoucherSheet me={me} orderId={openOrder} onClose={() => setOpenOrder(null)} />
      ) : null}

      {sentNote ? (
        <div className="sheetwrap">
          <button className="scrim" aria-label="닫기" onClick={() => setSentNote(null)} />
          <div className="sheet" role="dialog" aria-modal="true" aria-label="선물을 보냈습니다">
            <div className="grab" />
            <h2>선물을 보냈습니다</h2>
            <p className="note good">{sentNote.text}</p>
            <div className="actionsrow">
              <button className="pill" onClick={() => setSentNote(null)}>
                계속 둘러보기
              </button>
              <button
                className="pill solid"
                onClick={() => {
                  const chatId = sentNote.chatId;
                  setSentNote(null);
                  onClose();
                  onOpenChat(chatId);
                }}
              >
                대화방에서 보기
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 테마 라벨을 바깥(더보기 등)에서도 쓸 수 있게 열어둔다. */
export const themeLabel = (id: ThemeId): string =>
  THEMES.find((t) => t.id === id)?.label ?? id;
