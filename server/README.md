# hello-talk server

hello-talk 프런트엔드를 위한 백엔드다. Node.js + TypeScript + Fastify + PostgreSQL 로
동작하며, 프런트엔드의 순수 도메인 코드(`../src/domain/*`)를 **복사하지 않고 그대로**
가져와 서버와 클라이언트가 같은 규칙(선물 생애·정산·안읽음 계산 등)을 공유한다.

지금 이 스캐폴드에는 헬스체크 엔드포인트 하나만 있다. 비즈니스 엔드포인트·DB 스키마·인증은
다음 작업에서 붙는다.

## 사전 준비

- Node 22 (전역 Web Crypto 필요 — `src/domain/ids.ts` 가 `crypto.randomUUID` 를 쓴다)
- Docker (로컬 PostgreSQL 용). 이 환경에는 `docker compose` 플러그인이 없어
  `scripts/db.sh` 가 plain `docker run` 으로 컨테이너 하나를 관리한다.

## PostgreSQL (로컬)

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
npm run dev        # tsx watch 로 소스에서 바로 실행
npm start          # tsx 로 1회 실행

curl -s http://127.0.0.1:5311/health   # => {"status":"ok"}
```

## 검증

```bash
npm run typecheck  # tsc --noEmit
npm run build      # tsc emit -> dist/ (타입·산출물 검증용)
npm test           # vitest run (도메인 재사용 + /health 테스트)
```

## 설정 (환경변수)

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `5311` | 서버 포트 |
| `HOST` | `127.0.0.1` | 바인딩 호스트 |
| `DATABASE_URL` | 위 기본 접속 문자열 | PostgreSQL 접속 |
| `COOKIE_SECRET` | dev 전용 값 | 세션 쿠키 서명. 운영에서는 반드시 주입 |

## 도메인 코드 재사용

`tsconfig.json` 의 `include` 에 `../src/domain` 을 넣어 프런트엔드의 순수 모듈을
서버 컴파일 대상에 포함시킨다. 루트와 동일한 `bundler` 모듈 해석을 써서 확장자 없는
상대 import(`./types` 등)가 그대로 동작한다. 런타임은 `tsx` 가 담당하므로 도메인
파일을 서버용으로 고칠 필요가 없다.
