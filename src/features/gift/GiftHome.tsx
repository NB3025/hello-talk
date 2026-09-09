import { useState } from 'react';
import { Avatar } from '../../ui/Avatar';
import { useStore } from '../../store/StoreProvider';
import { friendsOf } from '../../domain/selectors';
import {
  CATEGORIES,
  PRODUCTS,
  THEMES,
  productsOfCategory,
  productsOfTheme,
  ranking,
  type CategoryId,
  type Product,
  type ThemeId,
} from '../../domain/products';
import type { User, UserId } from '../../domain/types';
import { ProductGrid } from './ProductGrid';

/**
 * 레퍼런스 선물하기 홈 (`references/gift/NOTES.md` 1번 화면).
 *
 * 화면 최상단이 "선물할 친구를 선택해 주세요"인 것이 이 화면의 핵심이다 —
 * 실제 카카오톡도 상품보다 사람을 먼저 묻고, 그게 우리가 B안을 고른 근거와 같다.
 */
export function GiftHome({
  me,
  recipientId,
  onPickRecipient,
  onPickTheme,
  onPickProduct,
  recentlyViewed,
}: {
  me: User;
  recipientId: UserId | null;
  onPickRecipient: (id: UserId | null) => void;
  onPickTheme: (theme: ThemeId) => void;
  onPickProduct: (p: Product) => void;
  recentlyViewed: Product[];
}) {
  const { db } = useStore();
  const friends = friendsOf(db, me.id);
  const [seg, setSeg] = useState<'theme' | 'category' | 'recent'>('theme');
  const [category, setCategory] = useState<CategoryId | null>(null);

  return (
    <>
      <FriendPicker
        friends={friends}
        recipientId={recipientId}
        onPickRecipient={onPickRecipient}
      />

      <div className="segment" role="tablist" aria-label="찾는 방식">
        {(
          [
            ['theme', '선물 테마'],
            ['category', '카테고리'],
            ['recent', '최근 본'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={seg === id}
            className={seg === id ? 'on' : ''}
            onClick={() => setSeg(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {seg === 'theme' ? (
        <div className="tilegrid">
          {THEMES.map((t) => (
            <button key={t.id} className="tile" onClick={() => onPickTheme(t.id)}>
              <span className="art" style={{ background: t.tint }} aria-hidden="true">
                {t.glyph}
              </span>
              {t.badge ? <span className="tbadge">{t.badge}</span> : null}
              <span className="tlabel">{t.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {seg === 'category' ? (
        <>
          <div className="chiprow">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                className={category === c.id ? 'chip on' : 'chip'}
                onClick={() => setCategory(category === c.id ? null : c.id)}
              >
                <span aria-hidden="true">{c.glyph}</span> {c.label}
              </button>
            ))}
          </div>
          <ProductGrid
            products={category ? productsOfCategory(category) : PRODUCTS}
            onPick={onPickProduct}
          />
        </>
      ) : null}

      {seg === 'recent' ? (
        <ProductGrid
          products={recentlyViewed}
          onPick={onPickProduct}
          empty="아직 본 상품이 없습니다. 테마나 랭킹에서 상품을 열어보세요."
        />
      ) : null}
    </>
  );
}

function FriendPicker({
  friends,
  recipientId,
  onPickRecipient,
}: {
  friends: User[];
  recipientId: UserId | null;
  onPickRecipient: (id: UserId | null) => void;
}) {
  return (
    <div className="whoband">
      <div className="whoscroll">
        <button
          className={recipientId ? 'whocard' : 'whocard on'}
          onClick={() => onPickRecipient(null)}
        >
          <span className="plus" aria-hidden="true">
            ＋
          </span>
          <span className="cap">
            선물할 친구를
            <br />
            선택해 주세요.
          </span>
        </button>

        {friends.length === 0 ? (
          <div className="whonone">
            친구 탭에서 친구를 먼저 등록하세요.
            <br />
            받는 사람 없이는 선물을 보낼 수 없습니다.
          </div>
        ) : (
          friends.map((f) => (
            <button
              key={f.id}
              className={recipientId === f.id ? 'whocard on' : 'whocard'}
              onClick={() => onPickRecipient(f.id)}
              aria-pressed={recipientId === f.id}
            >
              <Avatar user={f} size={44} />
              <span className="tagbadge">고마운 친구</span>
              <span className="nm">{f.name}</span>
              <span className="sub">{recipientId === f.id ? '받는 사람' : '추천 친구'}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/** 레퍼런스 랭킹 화면(2번). 순위·갱신 시각·카테고리 스크롤을 그대로 가져왔다. */
export function GiftRanking({
  recipientId,
  onPickProduct,
}: {
  recipientId: UserId | null;
  onPickProduct: (p: Product) => void;
}) {
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [freeOnly, setFreeOnly] = useState(false);

  let list = category ? productsOfCategory(category) : PRODUCTS;
  if (freeOnly) list = list.filter((p) => p.freeShipping);

  return (
    <>
      <div className="chiprow">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            className={category === c.id ? 'chip on' : 'chip'}
            onClick={() => setCategory(category === c.id ? null : c.id)}
          >
            <span aria-hidden="true">{c.glyph}</span> {c.label}
          </button>
        ))}
      </div>

      <div className="filterline">
        <button
          className={freeOnly ? 'checkbtn on' : 'checkbtn'}
          onClick={() => setFreeOnly(!freeOnly)}
          aria-pressed={freeOnly}
        >
          <span aria-hidden="true">{freeOnly ? '✔' : '○'}</span> 무료배송
        </button>
        {/* 순위가 실시간이 아님을 밝히는 장치. 레퍼런스도 기준 시각을 적는다. */}
        <span className="asof">{asOfLabel()} 기준</span>
      </div>

      <ProductGrid products={ranking(list)} ranked onPick={onPickProduct} />

      {recipientId ? null : (
        <div className="floatpill" role="status">
          🎁 누구를 위한 선물인가요?
        </div>
      )}
    </>
  );
}

/** 정시로 내림한 지금 시각. 랭킹이 매 렌더마다 바뀌어 보이지 않게 한다. */
const asOfLabel = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:00`;
};

/** 테마 하나를 펼친 화면. 상단 스크롤 탭에서 고른 경우도 여기로 온다. */
export function GiftThemeView({
  theme,
  onPickProduct,
}: {
  theme: ThemeId;
  onPickProduct: (p: Product) => void;
}) {
  const meta = THEMES.find((t) => t.id === theme);
  const products = productsOfTheme(theme);

  return (
    <>
      <div className="themehead">
        <span className="art" style={{ background: meta?.tint }} aria-hidden="true">
          {meta?.glyph}
        </span>
        <div>
          <b>{meta?.label}</b>
          <div className="sub">{products.length}개의 선물</div>
        </div>
      </div>
      <ProductGrid products={ranking(products)} onPick={onPickProduct} />
    </>
  );
}
