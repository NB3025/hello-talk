-- hello-talk 백엔드 스키마. src/domain/types.ts 의 Db 형태를 그대로 옮긴다.
--
-- 설계 불변식(프런트엔드와 동일하게 유지한다):
--  - 친구 관계는 단방향이다 → friendships 는 (owner_id, friend_id) 로 유니크.
--  - 1:1 대화방은 두 사람당 하나뿐 → direct_pair_key 로 유니크 인덱스.
--  - 안읽음 개수는 저장하지 않고 계산한다 → reads 는 방·사람별 last_read_at 하나만.
--  - 선물의 저장 상태는 paid|accepted|used|refunded 넷뿐 (expired/draft/cancelled 는 계산·비저장).
--  - 정산 원장(ledger)은 gift.ts 가 만든 것을 그대로 jsonb 로 담는다.

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  status_message TEXT NOT NULL DEFAULT '',
  hue            TEXT NOT NULL,
  created_at     BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS friendships (
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  favorite   BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (owner_id, friend_id)
);

CREATE TABLE IF NOT EXISTS chats (
  id         TEXT PRIMARY KEY,
  title      TEXT,
  created_at BIGINT NOT NULL,
  -- 1:1 방의 정규화된 쌍 키. 제목 없는(=1:1) 방에만 채운다.
  -- 같은 두 사람 사이에 방이 둘 생기지 않도록 DB 레벨에서 막는다.
  direct_pair_key TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS chats_direct_pair_key_uq
  ON chats (direct_pair_key)
  WHERE direct_pair_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,
  chat_id       TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  created_at    BIGINT NOT NULL,
  kind          TEXT,
  gift_order_id TEXT
);

CREATE INDEX IF NOT EXISTS messages_chat_id_idx ON messages (chat_id);

CREATE TABLE IF NOT EXISTS reads (
  chat_id      TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at BIGINT NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS gift_orders (
  id              TEXT PRIMARY KEY,
  product_id      TEXT NOT NULL,
  sender_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id         TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message         TEXT NOT NULL,
  price           INTEGER NOT NULL,
  status          TEXT NOT NULL,
  paid_at         BIGINT NOT NULL,
  responded_at    BIGINT,
  expires_at      BIGINT,
  extensions_used INTEGER NOT NULL DEFAULT 0,
  used_at         BIGINT,
  closed_by       TEXT,
  refund_amount   INTEGER,
  ledger          JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- 멱등성 키 저장소. 같은 클라이언트 키로 온 재시도가 중복 생성하지 않도록,
-- 명령 실행 결과(생성된 id 등)를 키에 붙여 두고 재시도 시 그대로 돌려준다.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope      TEXT NOT NULL,
  actor_id   TEXT NOT NULL,
  key        TEXT NOT NULL,
  result     JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (scope, actor_id, key)
);
