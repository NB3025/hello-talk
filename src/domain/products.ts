/**
 * 상품 카탈로그.
 *
 * **저장소(Db)에 넣지 않는다.** 카탈로그는 사용자가 만드는 데이터가 아니라 앱이 들고 오는
 * 것이고, localStorage 에 복사해 두면 코드에서 상품을 고칠 때마다 이미 저장된 사본과
 * 어긋난다. 주문(`GiftOrder`)은 `productId` 와 **결제 당시 가격**을 함께 들고 있어서,
 * 카탈로그가 바뀌어도 이미 보낸 선물의 정산은 흔들리지 않는다.
 *
 * 상품 사진은 쓰지 않는다 — 실제 브랜드 이미지를 복제하지 않으려는 것이고, 대신
 * 이모지 한 글자와 결정론적 배경색으로 자리를 채운다. 아바타에서 쓰는 방식과 같다.
 */

export interface Product {
  id: string;
  brand: string;
  name: string;
  price: number;
  /** 상품 사진 대신 쓰는 이모지 */
  glyph: string;
  /** 카드 배경색 */
  tint: string;
  themes: ThemeId[];
  category: CategoryId;
  freeShipping: boolean;
  giftWrap: boolean;
  likes: number;
  /** 랭킹 정렬 기준이자 카드에 표시하는 "최근 구매 N명" */
  recentBuyers: number;
}

export type ThemeId =
  | 'birthday'
  | 'chuseok'
  | 'tasty'
  | 'health'
  | 'forme'
  | 'light'
  | 'luxury'
  | 'small-luxury'
  | 'baby'
  | 'wedding'
  | 'cool'
  | 'colleague'
  | 'voucher'
  | 'pass'
  | 'wine';

export interface Theme {
  id: ThemeId;
  label: string;
  glyph: string;
  tint: string;
  /** 레퍼런스 홈의 `주목` 같은 배지 */
  badge?: string;
}

/** 레퍼런스 홈의 5열 × 3행 그리드와 같은 순서·개수. */
export const THEMES: Theme[] = [
  { id: 'birthday', label: '생일', glyph: '🎂', tint: '#FDE2EC' },
  { id: 'chuseok', label: '추석선물', glyph: '🌕', tint: '#FFE9C7', badge: '주목' },
  { id: 'tasty', label: '맛있는선물', glyph: '🥩', tint: '#F8D6CE' },
  { id: 'health', label: '건강·비타민', glyph: '💊', tint: '#DCEEDF' },
  { id: 'forme', label: 'FOR ME', glyph: '🤍', tint: '#2E2A3B' },
  { id: 'light', label: '가벼운선물', glyph: '🧁', tint: '#FCE4D6' },
  { id: 'luxury', label: '명품선물', glyph: '💎', tint: '#E4E1EF' },
  { id: 'small-luxury', label: '스몰럭셔리', glyph: '🫧', tint: '#F3E7F5' },
  { id: 'baby', label: '출산·돌', glyph: '👶', tint: '#DEEAF6' },
  { id: 'wedding', label: '결혼·집들이', glyph: '🍽', tint: '#EFE7DC' },
  { id: 'cool', label: '시원한선물', glyph: '🍧', tint: '#DCEDF7' },
  { id: 'colleague', label: '직장동료', glyph: '☕', tint: '#E7E4DE' },
  { id: 'voucher', label: '교환권', glyph: '🎟', tint: '#FFF0C2' },
  { id: 'pass', label: '합격·응원', glyph: '🍀', tint: '#E1F0DC' },
  { id: 'wine', label: '와인/위스키', glyph: '🍷', tint: '#EADCE0' },
];

export type CategoryId =
  | 'gift-card'
  | 'food'
  | 'beauty'
  | 'living'
  | 'fashion'
  | 'liquor'
  | 'health-goods'
  | 'pet';

export interface Category {
  id: CategoryId;
  label: string;
  glyph: string;
}

export const CATEGORIES: Category[] = [
  { id: 'gift-card', label: '교환권·상품권', glyph: '🎟' },
  { id: 'food', label: '식품', glyph: '🍱' },
  { id: 'beauty', label: '뷰티', glyph: '💄' },
  { id: 'living', label: '리빙·가전', glyph: '🏠' },
  { id: 'fashion', label: '패션·잡화', glyph: '👜' },
  { id: 'liquor', label: '주류', glyph: '🥃' },
  { id: 'health-goods', label: '건강식품', glyph: '💊' },
  { id: 'pet', label: '반려동물', glyph: '🐶' },
];

/** 브랜드명은 가상 상호다. 실제 상표를 쓰지 않는다. */
export const PRODUCTS: Product[] = [
  {
    id: 'p-americano',
    brand: '별다방커피',
    name: '아이스 아메리카노 T 2잔 교환권',
    price: 9000,
    glyph: '☕',
    tint: '#DDE7DE',
    themes: ['voucher', 'light', 'colleague'],
    category: 'gift-card',
    freeShipping: true,
    giftWrap: false,
    likes: 5117,
    recentBuyers: 482,
  },
  {
    id: 'p-latte-cake',
    brand: '별다방커피',
    name: '카페 라떼 + 뉴욕 치즈케이크 세트',
    price: 15500,
    glyph: '🍰',
    tint: '#F4E3D2',
    themes: ['voucher', 'light', 'birthday'],
    category: 'gift-card',
    freeShipping: true,
    giftWrap: false,
    likes: 2841,
    recentBuyers: 251,
  },
  {
    id: 'p-burger-50',
    brand: '골든아치',
    name: '디지털 상품권 5만원권',
    price: 50000,
    glyph: '🍟',
    tint: '#FFD84D',
    themes: ['voucher', 'colleague'],
    category: 'gift-card',
    freeShipping: true,
    giftWrap: false,
    likes: 1903,
    recentBuyers: 337,
  },
  {
    id: 'p-icecream-pint',
    brand: '서른한가지맛',
    name: '파인트 아이스크림 교환권',
    price: 9800,
    glyph: '🍨',
    tint: '#F7DCE8',
    themes: ['voucher', 'cool', 'light'],
    category: 'gift-card',
    freeShipping: true,
    giftWrap: false,
    likes: 3320,
    recentBuyers: 198,
  },
  {
    id: 'p-strawberry-cake',
    brand: '두썸빵집',
    name: '스트로베리 초콜릿 생크림 케이크',
    price: 38000,
    glyph: '🎂',
    tint: '#FBD9E3',
    themes: ['birthday'],
    category: 'food',
    freeShipping: true,
    giftWrap: true,
    likes: 1204,
    recentBuyers: 143,
  },
  {
    id: 'p-hanwoo',
    brand: '한우상회',
    name: '1++ 등급 한우 등심 선물세트 500g',
    price: 189000,
    glyph: '🥩',
    tint: '#F0CFC8',
    themes: ['chuseok', 'tasty'],
    category: 'food',
    freeShipping: true,
    giftWrap: true,
    likes: 836,
    recentBuyers: 121,
  },
  {
    id: 'p-immune',
    brand: '오소몰',
    name: '멀티비타민 이무네 30일분',
    price: 82000,
    glyph: '💊',
    tint: '#E6EFDC',
    themes: ['health', 'chuseok'],
    category: 'health-goods',
    freeShipping: true,
    giftWrap: true,
    likes: 5011,
    recentBuyers: 402,
  },
  {
    id: 'p-lacto',
    brand: '건강한하루',
    name: '유산균 락토핏 골드 3개월분',
    price: 34900,
    glyph: '🦠',
    tint: '#DFEDE7',
    themes: ['health'],
    category: 'health-goods',
    freeShipping: true,
    giftWrap: false,
    likes: 4260,
    recentBuyers: 288,
  },
  {
    id: 'p-earbuds',
    brand: '사과전자',
    name: '무선 이어버드 4세대',
    price: 199000,
    glyph: '🎧',
    tint: '#EDEDF1',
    themes: ['forme', 'luxury'],
    category: 'living',
    freeShipping: true,
    giftWrap: true,
    likes: 7702,
    recentBuyers: 511,
  },
  {
    id: 'p-hairdryer',
    brand: '다이손',
    name: '슈퍼소닉 헤어드라이어',
    price: 429000,
    glyph: '💨',
    tint: '#E3DCEB',
    themes: ['luxury', 'wedding'],
    category: 'living',
    freeShipping: true,
    giftWrap: true,
    likes: 2210,
    recentBuyers: 96,
  },
  {
    id: 'p-perfume',
    brand: '조말롱런던',
    name: '잉글리쉬 페어 앤 프리지아 100ml',
    price: 248000,
    glyph: '🫧',
    tint: '#F1E6DA',
    themes: ['small-luxury', 'forme'],
    category: 'beauty',
    freeShipping: true,
    giftWrap: true,
    likes: 6180,
    recentBuyers: 274,
  },
  {
    id: 'p-handkit',
    brand: '프로방스로',
    name: '미니 핸드크림 키트 4종',
    price: 32000,
    glyph: '🧴',
    tint: '#F6EBD5',
    themes: ['light', 'small-luxury', 'colleague'],
    category: 'beauty',
    freeShipping: true,
    giftWrap: true,
    likes: 4408,
    recentBuyers: 366,
  },
  {
    id: 'p-lipstick',
    brand: '루체뷰티',
    name: '페인트 매트 립스틱',
    price: 62000,
    glyph: '💄',
    tint: '#F4DCE0',
    themes: ['small-luxury', 'forme'],
    category: 'beauty',
    freeShipping: true,
    giftWrap: true,
    likes: 1877,
    recentBuyers: 158,
  },
  {
    id: 'p-pen',
    brand: '몽블랜',
    name: '마이스터스튁 클래식 볼펜',
    price: 385000,
    glyph: '🖋',
    tint: '#E2E0E4',
    themes: ['luxury', 'pass', 'colleague'],
    category: 'fashion',
    freeShipping: true,
    giftWrap: true,
    likes: 731,
    recentBuyers: 44,
  },
  {
    id: 'p-macaron',
    brand: '마카롱하우스',
    name: '마카롱 12구 선물세트',
    price: 28000,
    glyph: '🧁',
    tint: '#FBE6EE',
    themes: ['tasty', 'light', 'birthday'],
    category: 'food',
    freeShipping: false,
    giftWrap: true,
    likes: 2933,
    recentBuyers: 221,
  },
  {
    id: 'p-minicup',
    brand: '하겐다우',
    name: '아이스크림 미니컵 8입 세트',
    price: 24000,
    glyph: '🍦',
    tint: '#EADFCF',
    themes: ['cool', 'tasty'],
    category: 'food',
    freeShipping: true,
    giftWrap: true,
    likes: 3517,
    recentBuyers: 305,
  },
  {
    id: 'p-whisky',
    brand: '발렌타운',
    name: '블렌디드 위스키 12년 700ml',
    price: 62000,
    glyph: '🥃',
    tint: '#EEDFC6',
    themes: ['wine', 'chuseok', 'colleague'],
    category: 'liquor',
    freeShipping: true,
    giftWrap: true,
    likes: 1642,
    recentBuyers: 133,
  },
  {
    id: 'p-pinot',
    brand: '도멘루아',
    name: '부르고뉴 피노누아 750ml',
    price: 78000,
    glyph: '🍷',
    tint: '#E7D5DA',
    themes: ['wine', 'wedding'],
    category: 'liquor',
    freeShipping: true,
    giftWrap: true,
    likes: 1109,
    recentBuyers: 87,
  },
  {
    id: 'p-baby-set',
    brand: '아기별',
    name: '신생아 배냇저고리 3종 세트',
    price: 45000,
    glyph: '👶',
    tint: '#E4EEF7',
    themes: ['baby'],
    category: 'fashion',
    freeShipping: true,
    giftWrap: true,
    likes: 962,
    recentBuyers: 71,
  },
  {
    id: 'p-diaper',
    brand: '소프트베베',
    name: '네이처메이드 기저귀 4팩',
    price: 58000,
    glyph: '🧷',
    tint: '#DFEAE4',
    themes: ['baby'],
    category: 'living',
    freeShipping: true,
    giftWrap: false,
    likes: 1488,
    recentBuyers: 164,
  },
  {
    id: 'p-cocotte',
    brand: '르쿠제',
    name: '시그니처 코코트 라운드 22cm',
    price: 259000,
    glyph: '🍲',
    tint: '#F2D9CE',
    themes: ['wedding', 'luxury'],
    category: 'living',
    freeShipping: true,
    giftWrap: true,
    likes: 2077,
    recentBuyers: 108,
  },
  {
    id: 'p-candle',
    brand: '딥티끄',
    name: '베이 시그니처 캔들 190g',
    price: 98000,
    glyph: '🕯',
    tint: '#EDE6DA',
    themes: ['wedding', 'small-luxury'],
    category: 'living',
    freeShipping: true,
    giftWrap: true,
    likes: 3044,
    recentBuyers: 192,
  },
  {
    id: 'p-petfood',
    brand: '펫로얄',
    name: '반려견 건식 사료 8kg',
    price: 72000,
    glyph: '🐶',
    tint: '#EFE3D3',
    themes: ['forme'],
    category: 'pet',
    freeShipping: true,
    giftWrap: false,
    likes: 1355,
    recentBuyers: 149,
  },
  {
    id: 'p-chicken',
    brand: '꼬꼬촌',
    name: '허니콤보 + 콜라 1.25L 교환권',
    price: 23000,
    glyph: '🍗',
    tint: '#F6E0C4',
    themes: ['tasty', 'pass', 'light'],
    category: 'food',
    freeShipping: true,
    giftWrap: false,
    likes: 6602,
    recentBuyers: 574,
  },
];

const BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));

export const productById = (id: string): Product | undefined => BY_ID.get(id);

export const themeById = (id: ThemeId): Theme | undefined => THEMES.find((t) => t.id === id);

export const productsOfTheme = (theme: ThemeId): Product[] =>
  PRODUCTS.filter((p) => p.themes.includes(theme));

export const productsOfCategory = (category: CategoryId): Product[] =>
  PRODUCTS.filter((p) => p.category === category);

/** 급상승 랭킹. 카드의 순위 배지는 이 순서의 인덱스다. */
export const ranking = (list: Product[] = PRODUCTS): Product[] =>
  [...list].sort((a, b) => b.recentBuyers - a.recentBuyers);

export const wonLabel = (won: number): string => `${won.toLocaleString('ko-KR')}원`;
