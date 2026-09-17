#!/usr/bin/env bash
# Docker 가 없는 Ubuntu(예: 워크샵 VS Code 서버)에서 로컬 PostgreSQL 을 한 번 준비한다. sudo 와 apt 를 쓴다.
# demo.sh 는 설치를 하지 않으므로, 이 스크립트를 사람이 알고서 한 번 실행한다(EC2 이미지 빌드에 넣어도 된다).
#
#   bash scripts/demo/prepare-local-pg.sh            # 비밀번호는 무작위로 만들어 마지막 줄에 DATABASE_URL 로 찍는다
#   DB_PASSWORD=원하는값 bash scripts/demo/prepare-local-pg.sh
#
# 하는 일: apt-get install postgresql → 서비스 시작 → postgres 사용자 비밀번호 설정 → hello_talk DB 생성.
set -euo pipefail

DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 24)}"
DB_NAME="${DB_NAME:-hello_talk}"

command -v apt-get >/dev/null || { echo "apt 가 없는 시스템입니다. PostgreSQL 을 직접 준비하고 DATABASE_URL 을 주세요." >&2; exit 2; }

if ! command -v psql >/dev/null 2>&1; then
  echo "PostgreSQL 을 apt 로 설치합니다 (sudo)"
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q postgresql >/dev/null
fi
sudo systemctl start postgresql 2>/dev/null || sudo service postgresql start
for _ in $(seq 1 30); do sudo -u postgres pg_isready -q 2>/dev/null && break; sleep 1; done
sudo -u postgres pg_isready -q || { echo "PostgreSQL 이 뜨지 않았습니다." >&2; exit 1; }

sudo -u postgres psql -v ON_ERROR_STOP=1 -qc "ALTER USER postgres PASSWORD '$DB_PASSWORD';"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres createdb "$DB_NAME"

echo
echo "준비됨. 아래를 셸 프로필(~/.bashrc 등)에 넣거나 demo 앞에 붙여 실행하세요:"
echo "  export DATABASE_URL='postgres://postgres:$DB_PASSWORD@127.0.0.1:5432/$DB_NAME'"
echo "  npm run demo"
