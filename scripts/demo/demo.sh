#!/usr/bin/env bash
# hello-talk "실패 보기" 시연을 한 번에 띄운다 (클로드코드 마스터 클래스 1-6 0단계).
#   PostgreSQL → 백엔드(5311, DEV_TOOLS=1) → 상대 봇(bot.mjs) → 장애 프록시(5399, 첫 메시지 전송의 응답을 끊음) → 프런트엔드(5273)
# 상대방은 봇이 맡으므로 브라우저는 하나면 된다. 노트북이든 VS Code 서버(code-server)든 같은 명령이다.
#
#   npm run demo                 # = bash scripts/demo/demo.sh (저장소 어디서 실행해도 된다)
#   npm run demo -- --print      # 실행하지 않고 감지한 설정만 보여준다
#
# PostgreSQL 은 이 순서로 고른다. 이 스크립트는 아무것도 설치하지 않고 sudo 도 쓰지 않는다.
#   1) DATABASE_URL 이 있으면 그대로 쓴다 (예: postgres://postgres:pw@127.0.0.1:5432/hello_talk)
#   2) Docker 가 돌고 있으면 server/scripts/db.sh 로 컨테이너를 띄운다
#   3) 둘 다 없으면 scripts/demo/prepare-local-pg.sh 를 안내하고 멈춘다
#
# 종료: Ctrl+C. 띄운 프로세스를 모두 내린다. PostgreSQL 은 남긴다(컨테이너는 cd server && npm run db:down).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"
[ -f package.json ] && [ -d server ] || { echo "hello-talk 저장소가 아닙니다: $ROOT" >&2; exit 2; }

BACKEND_PORT=5311; PROXY_PORT=5399; FRONT_PORT=5273

# ── 어디서 실행 중인지 감지 ───────────────────────────────────────────────
# code-server 는 통합 터미널에 VSCODE_PROXY_URI=https://<host>/proxy/{{port}}/ 를 넣어 준다.
MODE=laptop; HOST=""
if [ -n "${VSCODE_PROXY_URI:-}" ]; then
  MODE=code-server
  HOST="$(printf '%s' "$VSCODE_PROXY_URI" | sed -E 's#^[a-zA-Z]+://##; s#/.*$##')"
fi

if [ "$MODE" = code-server ]; then
  # 브라우저는 CloudFront 도메인으로 들어온다. /absproxy/ 는 접두어를 보존해 Vite 의 절대 경로 자산이 살고,
  # API 는 같은 도메인의 /proxy/5399 로 가므로 CORS·Secure 쿠키 문제가 없다.
  OPEN_URL="https://$HOST/absproxy/$FRONT_PORT/"
  API_BASE="https://$HOST/proxy/$PROXY_PORT"
  VITE_ARGS=(--host 127.0.0.1 --port "$FRONT_PORT" --strictPort --base "/absproxy/$FRONT_PORT/")
  export __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="$HOST"
else
  # 노트북: 프런트(5273)와 API(5399)가 다른 오리진이면 서버가 CLIENT_ORIGIN + COOKIE_SECURE=1 을 요구한다.
  # 그래서 장애 프록시가 프런트엔드까지 같이 내보내고, 브라우저는 프록시 포트 하나만 연다.
  OPEN_URL="http://127.0.0.1:$PROXY_PORT/"
  API_BASE="http://127.0.0.1:$PROXY_PORT"
  VITE_ARGS=(--host 127.0.0.1 --port "$FRONT_PORT" --strictPort)
  export FRONT_TARGET="http://127.0.0.1:$FRONT_PORT"
fi

echo "실행 위치: $MODE${HOST:+ ($HOST)}"
echo "프런트엔드 → $OPEN_URL"
echo "API 주소   → $API_BASE  (장애 프록시 $PROXY_PORT → 백엔드 $BACKEND_PORT${FRONT_TARGET:+, 그 외 → 프런트 $FRONT_PORT})"
[ "${1:-}" = "--print" ] && exit 0

# ── 비밀값. 이미 있으면 그대로 쓴다(재실행 시 DB 비밀번호가 바뀌면 컨테이너와 어긋난다) ──
export DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 24)}"
export COOKIE_SECRET="${COOKIE_SECRET:-$(openssl rand -hex 32)}"

# ── 지난 실행이 남긴 프로세스 정리. Ctrl+C 가 자식의 자식(tsx, vite, node)까지 못 내린 경우가 있다 ──
STALE_PATTERN='scripts/demo/fault-proxy.mjs|scripts/demo/bot.mjs|tsx watch src/index.ts|vite --host 127.0.0.1 --port 5273'
stale="$(pgrep -f "$STALE_PATTERN" || true)"
if [ -n "$stale" ]; then
  echo "지난 실행의 프로세스를 정리한다: $(echo "$stale" | tr '\n' ' ')"
  # shellcheck disable=SC2086
  kill $stale 2>/dev/null || true; sleep 1
  # shellcheck disable=SC2086
  kill -9 $stale 2>/dev/null || true
fi
port_busy() { (command -v ss >/dev/null && ss -ltn 2>/dev/null | grep -q ":$1 ") || (command -v lsof >/dev/null && lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1); }
for port in "$BACKEND_PORT" "$PROXY_PORT" "$FRONT_PORT"; do
  if port_busy "$port"; then
    echo "포트 $port 를 다른 프로세스가 쓰고 있습니다. 확인: ss -ltnp | grep :$port  (또는 lsof -iTCP:$port)" >&2
    exit 2
  fi
done

[ -d node_modules ] || npm install
[ -d server/node_modules ] || (cd server && npm install)

# ── PostgreSQL ────────────────────────────────────────────────────────────
start_postgres() {
  if [ -n "${DATABASE_URL:-}" ]; then
    echo "PostgreSQL: DATABASE_URL 사용"
    return
  fi
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    echo "PostgreSQL: Docker 컨테이너 (server/scripts/db.sh)"
    (cd server && npm run db:up)
    return
  fi
  cat >&2 <<EOF
PostgreSQL 을 찾지 못했습니다. 둘 중 하나를 하세요.
  - Docker 를 켠다 (컨테이너로 띄운다), 또는
  - 로컬 PostgreSQL 을 한 번 준비한다 (sudo, apt):  bash scripts/demo/prepare-local-pg.sh
    준비 뒤에는 그 스크립트가 알려 주는 DATABASE_URL 을 주고 다시 실행한다.
EOF
  exit 2
}

PIDS=()
kill_tree() { local pid=$1; for c in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$c"; done; kill "$pid" 2>/dev/null || true; }
cleanup() {
  trap - EXIT INT TERM
  echo; echo "내리는 중..."
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill_tree "$p"; done
  sleep 1
  pkill -9 -f "$STALE_PATTERN" 2>/dev/null || true   # 살아남은 tsx/vite/node 마무리
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

start_postgres
(cd server && DEV_TOOLS=1 PORT="$BACKEND_PORT" npm run dev) & PIDS+=($!)
for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1 && break; sleep 1; done
curl -sf "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null || { echo "백엔드가 $BACKEND_PORT 에서 뜨지 않았습니다." >&2; exit 1; }

API="http://127.0.0.1:$BACKEND_PORT" node "$HERE/bot.mjs" & PIDS+=($!)
PROXY_PORT="$PROXY_PORT" TARGET="http://127.0.0.1:$BACKEND_PORT" node "$HERE/fault-proxy.mjs" & PIDS+=($!)
sleep 1

echo
echo "================================================================"
echo "  브라우저에서 열기:  $OPEN_URL"
echo "  이름을 만들면 봇이 먼저 인사한다 → 채팅 탭에서 방을 열고 답장(실패 표시) → 다시 전송"
echo "  → 봇이 \"2번째 메시지… 같은 내용이네요\" 라고 답한다. 서버에는 두 개가 저장된 것이다"
echo "  종료: Ctrl+C"
echo "================================================================"
echo
VITE_API_BASE="$API_BASE" npx vite "${VITE_ARGS[@]}" & PIDS+=($!)

# 자식 하나가 죽으면(포트 충돌 등) 반쪽만 남기지 않고 전부 내린다
while :; do
  for p in "${PIDS[@]}"; do
    if ! kill -0 "$p" 2>/dev/null; then
      echo "프로세스 $p 가 끝났습니다. 전체를 내립니다." >&2
      exit 1
    fi
  done
  sleep 2
done
