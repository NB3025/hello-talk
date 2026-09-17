#!/usr/bin/env bash
# 꼬였을 때 되돌리는 스크립트 (워크샵 참가자·강사 공용). 세 단계를 골라 쓴다.
#
#   npm run demo:reset               # 1) 지난 실행이 남긴 프로세스를 내리고 포트(5311·5399·5273)를 비운다. 언제나 안전
#   npm run demo:reset -- --repo     # 2) + 저장소를 origin/main 으로 되돌린다. 내 변경은 backup/<시각> 브랜치에 커밋해 두고 되돌린다
#   npm run demo:reset -- --db       # 3) + 시연 DB(hello_talk)를 비운다. 지난 시연의 봇·사용자·메시지가 사라진다
#   npm run demo:reset -- --all      # 1) + 2) + 3)
#
# 저장소 폴더 자체가 git 저장소가 아니면 이 스크립트가 아닐 자리다. 그때는 폴더를 비켜 두고 다시 클론한다:
#   cd ~/claude-practice && mv 1-6-hello-talk 1-6-hello-talk.old && git clone https://github.com/NB3025/hello-talk.git 1-6-hello-talk
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"

DO_REPO=0; DO_DB=0
for a in "$@"; do
  case "$a" in
    --repo) DO_REPO=1 ;;
    --db) DO_DB=1 ;;
    --all) DO_REPO=1; DO_DB=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "모르는 옵션: $a (--repo, --db, --all)" >&2; exit 2 ;;
  esac
done

step() { echo; echo "── $* ──"; }

# ── 1. 프로세스와 포트 ──────────────────────────────────────────────────────
step "1. 지난 실행의 프로세스 정리"
PATTERN='scripts/demo/demo.sh|scripts/demo/fault-proxy.mjs|scripts/demo/bot.mjs|fault-proxy.mjs|bot.mjs|tsx watch src/index.ts|vite --host 127.0.0.1|vite$|vite --port'
pids="$(pgrep -f "$PATTERN" | grep -v "^$$\$" || true)"
if [ -n "$pids" ]; then
  echo "내린다: $(echo "$pids" | tr '\n' ' ')"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true; sleep 1
  # shellcheck disable=SC2086
  kill -9 $pids 2>/dev/null || true
else
  echo "남은 프로세스 없음"
fi

port_holder() {
  if command -v ss >/dev/null 2>&1; then ss -ltnp 2>/dev/null | awk -v p=":$1" '$4 ~ p"$" {print $NF}';
  elif command -v lsof >/dev/null 2>&1; then lsof -iTCP:"$1" -sTCP:LISTEN -Fpc 2>/dev/null | paste -sd' ' -; fi
}
for port in 5311 5399 5273; do
  holder="$(port_holder "$port" || true)"
  if [ -n "$holder" ]; then
    echo "포트 $port 가 아직 막혀 있다: $holder"
    echo "  우리 프로세스가 아니면 그대로 두고, 우리 것이면: kill <pid>"
  else
    echo "포트 $port 비었음"
  fi
done

# ── 2. 저장소 ──────────────────────────────────────────────────────────────
if [ "$DO_REPO" = 1 ]; then
  step "2. 저장소를 origin/main 으로"
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "여기는 git 저장소가 아니다: $ROOT" >&2
    echo "폴더를 비켜 두고 다시 클론한다:  cd .. && mv $(basename "$ROOT") $(basename "$ROOT").old && git clone https://github.com/NB3025/hello-talk.git $(basename "$ROOT")" >&2
    exit 2
  fi
  git fetch -q origin
  if [ -n "$(git status --porcelain)" ]; then
    backup="backup/$(date +%Y%m%d-%H%M%S)"
    cur="$(git rev-parse --abbrev-ref HEAD)"
    git switch -q -c "$backup"
    git add -A
    git -c user.name="${GIT_AUTHOR_NAME:-workshop}" -c user.email="${GIT_AUTHOR_EMAIL:-workshop@example.invalid}" commit -q -m "reset.sh 백업: $cur 의 미커밋 변경" || true
    echo "미커밋 변경을 $backup 브랜치에 커밋해 두었다 (원래 브랜치: $cur). 되살리기: git switch $backup"
  fi
  git switch -q main 2>/dev/null || git switch -q -c main origin/main
  git reset -q --hard origin/main
  # 추적되지 않는 파일도 정리한다(백업 브랜치에 이미 들어 있다). 무시 목록(node_modules 등)은 건드리지 않는다
  git clean -qfd
  echo "main = $(git rev-parse --short HEAD) $(git log -1 --format=%s)"
  echo "내 브랜치는 그대로 있다: $(git branch --format='%(refname:short)' | grep -v '^main$' | tr '\n' ' ')"
  [ -d node_modules ] || npm install
  [ -d server/node_modules ] || (cd server && npm install)
fi

# ── 3. 시연 DB ─────────────────────────────────────────────────────────────
if [ "$DO_DB" = 1 ]; then
  step "3. 시연 DB 비우기"
  if [ -n "${DATABASE_URL:-}" ]; then
    command -v psql >/dev/null || { echo "psql 이 없다. PostgreSQL 클라이언트를 설치하거나 Docker 경로를 쓴다." >&2; exit 2; }
    psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
    echo "DATABASE_URL 의 스키마를 비웠다. 다음 npm run demo 가 스키마를 다시 만든다"
  elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    [ -n "${DB_PASSWORD:-}" ] || { echo "Docker 컨테이너를 다시 만들려면 DB_PASSWORD 가 필요하다 (demo 를 띄울 때 쓴 값)" >&2; exit 2; }
    (cd server && npm run -s db:reset)
    echo "컨테이너를 새로 만들었다"
  else
    echo "DATABASE_URL 도 Docker 도 없다. 비울 DB 를 찾지 못했다" >&2; exit 2
  fi
fi

echo
echo "끝. 다시 시작:  npm run demo   (참가자 실습은 claude-auto 로 이어서)"
