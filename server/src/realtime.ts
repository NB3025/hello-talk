import type { WebSocket } from 'ws';

/**
 * 단일 인스턴스 인-프로세스 팬아웃. Redis 없이, 연결된 소켓들에 변경 신호를 뿌린다.
 * 실제 상태가 바뀐 뮤테이션에서만 broadcast 를 부른다(무의미한 재렌더 루프 방지).
 */
export interface ChangeSignal {
  type: 'change';
  /** 어떤 명령이 바꿨는지 힌트. 클라이언트는 이걸 보고 스냅샷을 다시 받거나 부분 갱신한다. */
  scope: string;
}

export class RealtimeHub {
  private sockets = new Set<WebSocket>();

  add(socket: WebSocket): void {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => this.sockets.delete(socket));
  }

  broadcast(scope: string): void {
    const payload = JSON.stringify({ type: 'change', scope } satisfies ChangeSignal);
    for (const socket of this.sockets) {
      // readyState 1 === OPEN
      if (socket.readyState === 1) {
        try {
          socket.send(payload);
        } catch {
          this.sockets.delete(socket);
        }
      }
    }
  }

  get size(): number {
    return this.sockets.size;
  }
}
