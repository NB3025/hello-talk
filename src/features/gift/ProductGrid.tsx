import type { Product } from '../../domain/products';
import { wonLabel } from '../../domain/products';

/**
 * 레퍼런스 랭킹 화면(`references/gift/NOTES.md` 2번)의 2열 상품 카드.
 * 순위 배지와 "최근 구매 N명"은 랭킹 화면에서만 붙으므로 옵션으로 둔다.
 */
export function ProductGrid({
  products,
  ranked = false,
  onPick,
  empty,
}: {
  products: Product[];
  ranked?: boolean;
  onPick: (p: Product) => void;
  empty?: string;
}) {
  if (products.length === 0) {
    return (
      <div className="empty">
        <b>상품이 없습니다</b>
        {empty ?? '다른 테마나 카테고리를 골라보세요.'}
      </div>
    );
  }

  return (
    <div className="pgrid">
      {products.map((p, i) => (
        <ProductCard
          key={p.id}
          product={p}
          rank={ranked ? i + 1 : undefined}
          onPick={onPick}
        />
      ))}
    </div>
  );
}

function ProductCard({
  product,
  rank,
  onPick,
}: {
  product: Product;
  rank?: number;
  onPick: (p: Product) => void;
}) {
  return (
    <button className="pcard" onClick={() => onPick(product)}>
      <div className="thumb" style={{ background: product.tint }}>
        <span className="glyph" aria-hidden="true">
          {product.glyph}
        </span>
        {rank !== undefined ? <span className="rank">{rank}</span> : null}
        {rank !== undefined ? (
          <span className="buyers">최근 구매 {product.recentBuyers}명</span>
        ) : null}
      </div>
      <div className="brand">{product.brand} ›</div>
      <div className="pname">{product.name}</div>
      <div className="price">{wonLabel(product.price)}</div>
      <div className="chips">
        {product.freeShipping ? <span>무료배송</span> : null}
        {product.giftWrap ? <span>선물포장</span> : null}
      </div>
      <div className="pfoot">
        <span aria-hidden="true">🛍</span>
        <span>♡ {product.likes.toLocaleString('ko-KR')}</span>
      </div>
    </button>
  );
}
