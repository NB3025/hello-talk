# hello-talk server

hello-talk 프런트엔드를 위한 백엔드다. Node.js + TypeScript + Fastify + PostgreSQL 로
동작하며, 프런트엔드의 순수 도메인 코드(`../src/domain/*`)를 **복사하지 않고 그대로**
가져와 서버와 클라이언트가 같은 규칙(선물 생애·정산·안읽음 계산 등)을 공유한다.

이 서버가 시스템 오브 레코드다: REST 명령/조회 + WebSocket 실시간을 제공하고, 권한과
멱등성을 서버에서 강제한다. 선물 규칙(`checkGiftAction`/`applyGiftAction`)과 셀렉터는
`../src/domain` 의 순수 모듈을 재사용하며, 서버에서 다시 구현하지 않는다.

## 사전 준비

- Node 22 (전역 Web Crypto 필요 — `src/domain/ids.ts` 가 `crypto.randomUUID` 를 쓴다)
- 실행/운영용 PostgreSQL. 로컬 개발은 Docker 로 띄운다(`scripts/db.sh`, plain `docker run`).
  테스트는 Docker 없이도 돈다(아래 "테스트" 참고).

## PostgreSQL (로컬 개발)

```bash
npm run db:up      # 컨테이너를 띄우고 접속 가능해질 때까지 대기
npm run db:down    # 컨테이너 제거
npm run db:reset   # 초기화 후 재시작
bash scripts/db.sh status   # pg_isready
```

기본 접속 문자열: `postgres://postgres:postgres@127.0.0.1:5432/hello_talk`

## 개발 / 실행

```bash
npm install
npm run dev        # tsx watch 로 소스에서 바로 실행 (부팅 시 자동 마이그레이션)
npm start          # tsx 로 1회 실행

curl -s http://127.0.0.1:5311/health   # => {"status":"ok"}
```

부팅하면 `src/db/schema.sql` 의 스키마를 자동 적용한다(모두 `IF NOT EXISTS` 라 여러 번
실행해도 안전하다).

## 테스트

```bash
npm test           # vitest run — 진짜 PostgreSQL 통합 테스트
```

테스트는 **자체 완결**이다. `vitest` 의 globalSetup(`test/globalSetup.ts`)이 진짜
PostgreSQL 15 를 테스트 프로세스의 **자식 프로세스**로, **유닉스 소켓** 위에 띄운다
(`initdb` + `postgres`, 비특권 `postgres` OS 사용자로 실행). 시작·마이그레이션·테스트·종료가
`npm test` 한 번의 수명 안에서 모두 일어난다. DB 가 뜨지 않으면 조용히 건너뛰지 않고
크게 실패한다.

이 방식을 쓰는 이유: 이 실행 환경에서는 각 셸 명령이 수명이 짧은 PID·네트워크
네임스페이스에서 돌아 별도로 띄운 서버(Docker/백그라운드 프로세스)에 TCP 로 붙을 수
없다. 그래서 테스트는 같은 프로세스 수명 안의 자식 + 유닉스 소켓 경로를 쓴다. 접속
설정은 `PGHOST`(소켓 디렉터리)로 오버라이드되며, 운영/로컬 개발에서는 그냥
`DATABASE_URL`(TCP)로 붙는다 — 서버 코드는 어느 쪽인지 모른다(`src/db/pool.ts`).

## 검증

```bash
npm run typecheck  # tsc --noEmit
npm run build      # tsc emit -> dist/ (타입·산출물 검증용). 런타임은 tsx 로 돈다.
npm test           # 위 통합 테스트
```

## API

인증은 서명·HttpOnly 세션 쿠키(`ht_session`)로 한다. **행위자 정체성의 유일한 근거는
세션 쿠키**다 — 어떤 명령도 요청 바디의 user/actor id 를 권한 판단에 쓰지 않는다.

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/health` | 헬스체크 |
| POST | `/api/auth/session` | `{name}` 새 사용자 생성 후 로그인 / `{userId}` 기존 사용자로 로그인 |
| GET | `/api/auth/me` | 현재 세션 사용자 (없으면 401) |
| DELETE | `/api/auth/session` | 로그아웃 |
| GET | `/api/snapshot` | 전역 Db 스냅샷 (프런트 미러 하이드레이트용) |
| POST | `/api/friends` | `{code}` 친구 코드로 등록 |
| POST | `/api/friends/:friendId/favorite` | 즐겨찾기 토글 |
| DELETE | `/api/friends/:friendId` | 친구 삭제 |
| POST | `/api/chats/direct` | `{targetId}` 1:1 방 열기 (멱등) |
| POST | `/api/chats/:chatId/messages` | `{text, clientKey?}` 메시지 전송 (clientKey 로 멱등) |
| POST | `/api/chats/:chatId/read` | 읽음 처리 (읽을 것 없으면 no-op) |
| POST | `/api/gifts` | `{receiverId, productId, message, clientKey?}` 선물하기 (clientKey 로 멱등) |
| POST | `/api/gifts/:orderId/actions` | `{action}` 선물 후속 동작. **`FORCE_EXPIRE` 는 거절(400)** |
| WS | `/ws` | 세션 쿠키 인증. 실제 변경 시 `{type:'change', scope}` 브로드캐스트 |

멱등성: 메시지·선물 전송은 `clientKey` 로, 1:1 방 열기는 두 사람 쌍 키로 중복을 막는다.
WebSocket 은 실제 상태가 바뀐 뮤테이션에서만 신호를 낸다(무의미한 재렌더 루프 방지).

### dev 전용 seed/reset (운영에는 없음)

`DEV_TOOLS=1` 또는 `NODE_ENV=test` 일 때만 열린다. 운영 기본값에서는 닫혀 있다(404).
localRepository 의 데모용 `reset` 을 운영 API 로 노출하지 않기 위한 것이다.

- `POST /api/dev/reset` — 모든 테이블 비우기
- `POST /api/dev/seed` — 데모 사용자 4명(홍길동/김철수/이영희/박영수) 심기

## 설정 (환경변수)

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `5311` | 서버 포트 |
| `HOST` | `127.0.0.1` | 바인딩 호스트 |
| `DATABASE_URL` | 위 기본 접속 문자열 | PostgreSQL 접속 (TCP) |
| `PGHOST` | (없음) | 슬래시로 시작하면 유닉스 소켓 디렉터리로 접속 (테스트용) |
| `COOKIE_SECRET` | dev 전용 값 | 세션 쿠키 서명. 운영에서는 반드시 주입 |
| `DEV_TOOLS` | (없음) | `1` 이면 dev 전용 seed/reset 엔드포인트 개방 |

## 도메인 코드 재사용

`tsconfig.json` 의 `include` 에 `../src/domain` 을 넣어 프런트엔드의 순수 모듈을
서버 컴파일 대상에 포함시킨다. 루트와 동일한 `bundler` 모듈 해석을 써서 확장자 없는
상대 import(`./types` 등)가 그대로 동작한다. 런타임은 `tsx` 가 담당하므로 도메인
파일을 서버용으로 고칠 필요가 없다.

선물 상태 전이·정산 원장은 오직 `src/domain/gift.ts` 의 `applyGiftAction` 이 만든다.
서버 저장소(`src/repository.ts`)는 주문을 읽어 `applyGiftAction` 에 넘기고, 돌려받은
다음 주문을 그대로 저장한다 — 전이/원장을 손으로 다시 만들지 않는다.
