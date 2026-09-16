import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import pg from 'pg';

/**
 * 테스트용 진짜 PostgreSQL 15 를 Node 테스트 프로세스의 자식으로 띄운다.
 *
 * 왜 이렇게 하나: 이 샌드박스의 각 셸 명령은 수명이 짧은 PID·네트워크 네임스페이스에서
 * 돌아, 백그라운드로 띄운 서버가 명령이 끝나면 사라지고 루프백(127.0.0.1)도 막혀 있다.
 * 그래서 DB 를 `npm test` 한 번의 수명 안에서 자식 프로세스로 띄우고 유닉스 소켓으로 붙는다.
 *  - postgres 는 root 로 못 뜨므로 비특권 OS 사용자 `postgres` 로 실행한다.
 *  - node(테스트 프로세스 + pg 클라이언트)는 root 로 남는다 — postgres 사용자는 nvm 아래
 *    node 를 실행할 수 없기 때문. 소켓 위로 붙기만 하면 된다.
 *
 * 소켓 경로는 SOCK_FILE 에 적어 두고, 각 테스트 파일이 그것을 PGHOST 로 읽어 붙는다.
 */

const SOCK_FILE = '/tmp/htpg_test_sock_path';

let pgproc: ChildProcess | undefined;
let base = '';

export const setup = async (): Promise<void> => {
  base = `/tmp/htpg_${process.pid}_${Date.now()}`;
  const data = `${base}/data`;
  const sock = `${base}/sock`;
  mkdirSync(data, { recursive: true });
  mkdirSync(sock, { recursive: true });
  execSync(`chown -R postgres:postgres ${base}`);
  execSync(`su postgres -c "/usr/bin/initdb -D ${data} -U postgres -A trust --no-sync"`, {
    stdio: 'ignore',
  });

  const launch = `${base}/launch.sh`;
  writeFileSync(launch, `#!/bin/sh\nexec /usr/bin/postgres -D ${data} -k ${sock} -c listen_addresses=''\n`);
  chmodSync(launch, 0o777);
  execSync(`chown postgres:postgres ${launch}`);
  execSync(`chmod 777 ${sock}`);

  pgproc = spawn('su', ['postgres', '-c', launch], { stdio: ['ignore', 'ignore', 'inherit'] });

  // 서버가 소켓을 열 때까지 접속을 재시도한다. 뜨지 않으면 크게 실패한다(조용히 건너뛰지 않는다).
  const { Client } = pg;
  let connected = false;
  for (let i = 0; i < 60; i += 1) {
    const client = new Client({ host: sock, user: 'postgres', database: 'postgres' });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      connected = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!connected) {
    pgproc?.kill('SIGQUIT');
    throw new Error('테스트용 PostgreSQL 가 뜨지 않았습니다. (native child harness 실패)');
  }

  writeFileSync(SOCK_FILE, sock);
};

export const teardown = async (): Promise<void> => {
  pgproc?.kill('SIGQUIT');
  await new Promise((r) => setTimeout(r, 300));
  if (base) rmSync(base, { recursive: true, force: true });
  rmSync(SOCK_FILE, { force: true });
};
