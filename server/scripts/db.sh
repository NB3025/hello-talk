#!/usr/bin/env bash
# 로컬 개발·테스트용 PostgreSQL 컨테이너 하나를 관리한다.
#
# 이 호스트에는 PostgreSQL 이 설치돼 있지 않고 `docker compose` 플러그인도 없다.
# 그래서 plain `docker run` 으로 컨테이너 하나를 띄우고, dev 와 test 가 같은
# 명령으로 시작·정지·초기화할 수 있게 감싼다.
#
#   ./scripts/db.sh up      # 컨테이너를 띄우고 접속 가능해질 때까지 기다린다
#   ./scripts/db.sh down    # 컨테이너를 멈추고 지운다 (데이터도 사라진다)
#   ./scripts/db.sh reset   # down 후 up. 깨끗한 DB 로 다시 시작한다
#   ./scripts/db.sh status  # pg_isready 로 상태만 확인한다
#   ./scripts/db.sh wait     # 접속 가능해질 때까지만 기다린다
set -euo pipefail

CONTAINER="${DB_CONTAINER:-hello-talk-pg}"
IMAGE="${DB_IMAGE:-postgres:16-alpine}"
DB_NAME="${DB_NAME:-hello_talk}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"
DB_PORT="${DB_PORT:-5432}"

wait_ready() {
  echo "PostgreSQL 준비를 기다리는 중 (${CONTAINER})..."
  for _ in $(seq 1 30); do
    if docker exec "$CONTAINER" pg_isready -q >/dev/null 2>&1; then
      docker exec "$CONTAINER" pg_isready
      echo "준비됨."
      return 0
    fi
    sleep 1
  done
  echo "시간 초과: PostgreSQL 이 접속을 받지 못했습니다." >&2
  return 1
}

case "${1:-up}" in
  up)
    if [ -n "$(docker ps -aq -f name="^${CONTAINER}$")" ]; then
      docker start "$CONTAINER" >/dev/null
    else
      docker run --name "$CONTAINER" \
        -e POSTGRES_PASSWORD="$DB_PASSWORD" \
        -e POSTGRES_DB="$DB_NAME" \
        -p "${DB_PORT}:5432" \
        -d "$IMAGE" >/dev/null
    fi
    wait_ready
    ;;
  down)
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    echo "컨테이너를 제거했습니다: ${CONTAINER}"
    ;;
  reset)
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    docker run --name "$CONTAINER" \
      -e POSTGRES_PASSWORD="$DB_PASSWORD" \
      -e POSTGRES_DB="$DB_NAME" \
      -p "${DB_PORT}:5432" \
      -d "$IMAGE" >/dev/null
    wait_ready
    ;;
  status)
    docker exec "$CONTAINER" pg_isready
    ;;
  wait)
    wait_ready
    ;;
  *)
    echo "사용법: $0 {up|down|reset|status|wait}" >&2
    exit 2
    ;;
esac
