# scripts/demo — "실패 보기" 시연

클로드코드 마스터 클래스 1-6에서 쓰는 강사 시연 도구다. 서버 모드의 hello-talk에서 **서버는 저장했는데 응답이 유실되어 "전송 실패"로 보이고, 재시도하면 같은 메시지가 두 개 저장되는** 장면을 브라우저 하나로 재현한다.

```bash
npm run demo              # 전부 띄운다. 마지막 줄의 주소를 브라우저에서 연다. 종료는 Ctrl+C
npm run demo -- --print   # 감지한 설정만 본다
```

| 파일 | 역할 |
|---|---|
| `demo.sh` | PostgreSQL → 백엔드(5311, `DEV_TOOLS=1`) → 봇 → 장애 프록시(5399) → 프런트엔드(5273)를 순서대로 띄운다. code-server의 `VSCODE_PROXY_URI`를 읽어 CloudFront 도메인용 설정(Vite 허용 호스트, `/absproxy/5273/` base, API 주소)을 알아서 맞춘다. 설치와 sudo는 하지 않는다 |
| `fault-proxy.mjs` | 브라우저와 백엔드 사이. `DROP_NTH`번째(기본 1) 메시지 전송 `POST /api/chats/:id/messages`를 백엔드까지 보내 저장시킨 뒤 응답만 끊는다. `FRONT_TARGET`을 주면 `/api`, `/health`, `/ws` 외의 요청을 Vite로 넘겨 프런트엔드와 API를 한 포트로 내보낸다. 모든 응답에 `Connection: close` |
| `bot.mjs` | 상대방. 서버 API로 봇 사용자를 만들고, `/api/dev/users`로 새 사람을 찾아 친구 추가 + 1:1 방 열기 + 인사한다. 받은 메시지마다 "N번째 메시지 받았어요: 「…」"로 답하고, 바로 앞과 같은 내용이면 "같은 내용이네요. 두 번 보내셨나요?"를 덧붙인다. 프록시를 거치지 않고 백엔드에 직접 붙는다 |
| `prepare-local-pg.sh` | Docker가 없는 Ubuntu에서 로컬 PostgreSQL을 한 번 준비한다(sudo, apt). 끝나면 `DATABASE_URL`을 알려 준다 |

## 시연 순서

1. 브라우저에서 이름을 만든다. 1~2초 안에 봇이 친구 추가와 인사를 마치고 채팅 탭에 배지 1이 붙은 방이 생긴다.
2. 방을 열고 아무 말을 보낸다. "서버에 연결하지 못했습니다. 메시지는 전송되지 않았습니다"가 뜨고 입력창은 그대로인데, 곧 봇이 "1번째 메시지 받았어요"라고 답한다. 프록시 콘솔에 `[drop] … 백엔드 200`.
3. 다시 Enter. 봇이 "2번째 메시지 받았어요 … 같은 내용이네요"라고 답하고 내 말풍선도 두 개다.

원인은 `src/store/apiRepository.ts`의 `sendMessage`가 요청마다 `clientKey: newId()`를 만들어 서버의 멱등성 장치(`idempotency_keys`)가 동작할 기회가 없는 것이다. 같은 파일의 `sendGift`는 `orderId`를 키로 재사용해 이 문제가 없다. **이 버그는 워크샵 교재이므로 main에서 고치지 않는다.** 고친 버전이 필요하면 별도 브랜치에 둔다.

## 왜 이렇게 되어 있나

- **봇이 상대인 이유**: 서버 모드의 신원은 `ht_session` 쿠키라 같은 브라우저의 모든 탭이 한 사람이다. 두 번째 사람은 시크릿 창이나 다른 프로필이 필요하고, code-server 뒤에서는 거기서 다시 로그인해야 한다. 실제 서비스도 상대 역할은 테스트 계정·봇이 맡는다.
- **노트북에서 프록시가 프런트엔드까지 내보내는 이유**: 프런트 5273과 API 5399가 다른 오리진이면 서버가 `CLIENT_ORIGIN`과 `COOKIE_SECURE=1`을 요구한다(`server/src/config.ts`). http 노트북에서는 같은 오리진이 유일한 길이다. code-server에서는 브라우저가 한 도메인(`https://<host>/absproxy/5273/`, `/proxy/5399`)으로 들어오므로 원래 같은 오리진이다.
- **`Connection: close`인 이유**: Chrome은 재사용 중인 keep-alive 소켓이 응답 없이 끊기면 POST라도 조용히 한 번 더 보낸다. 같은 `clientKey`라 서버가 중복을 걸러 성공으로 끝나고 "실패"가 화면에 안 뜬다. 소켓 재사용을 막으면 끊김이 네트워크 오류로 드러난다.
- **`/absproxy/`인 이유**: code-server의 `/proxy/<port>/`는 접두어를 벗겨 넘기는데 Vite 개발 서버의 HTML은 `/@vite/client` 같은 절대 경로를 넣어 404가 난다. `/absproxy/`는 접두어를 보존하므로 `--base /absproxy/5273/`과 짝을 맞춘다. Microsoft `code serve-web`에는 `/absproxy/`가 없어 노트북에서 시연한다.

## 요구 사항

- Node 20 이상(`fetch`, `Headers.getSetCookie`). 루트와 `server/`의 `npm install`은 스크립트가 없으면 해 준다.
- PostgreSQL: `DATABASE_URL` 또는 Docker, 또는 `prepare-local-pg.sh`.
- 백엔드는 `DEV_TOOLS=1`(봇의 `/api/dev/users`, 로그인 화면의 "이미 있는 사람"). 시연이 끝나면 Ctrl+C로 내린다.

## 덧붙임: 같은 브라우저의 탭 두 개

두 번째 탭에서 로그인 화면의 "이미 있는 사람"으로 봇을 고르면, 첫 탭(화면상 강사)이 보낸 메시지가 봇 명의로 저장되어 왼쪽 말풍선으로 뜬다. 화면의 "나"(`src/store/StoreProvider.tsx`, 탭별 sessionStorage)와 서버의 "나"(브라우저 공용 쿠키)가 다른 사람을 가리키는 클라이언트 결함이다. 로그인 화면 문구가 "탭을 두 개 열어"라고 안내하므로 제품이 시키는 대로 하면 재현된다. 이것도 워크샵 재료라 그대로 둔다.
