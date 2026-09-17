#!/usr/bin/env node
// hello-talk 1-6 강사용 장애 프록시.
// 프런트엔드와 백엔드 사이에 서서 요청은 전부 백엔드로 보내되, 메시지 전송(POST /api/chats/:id/messages)의
// 응답을 N번째 요청에서 한 번 끊는다. 백엔드는 저장을 마쳤지만 브라우저는 "전송 실패"를 본다.
// 사용자가 재시도하면 클라이언트가 새 clientKey 를 만들어 같은 메시지가 두 번 저장된다.
//
//   node fault-proxy.mjs                       # 5399 → 5311, 첫 메시지 전송의 응답을 끊는다
//   DROP_NTH=3 node fault-proxy.mjs            # 세 번째 메시지 전송에서 끊는다
//   PROXY_PORT=5399 TARGET=http://127.0.0.1:5311 node fault-proxy.mjs
//   FRONT_TARGET=http://127.0.0.1:5273 node fault-proxy.mjs   # /api, /health, /ws 외의 요청은 Vite 로
//
// FRONT_TARGET 을 주면 프록시 하나가 프런트엔드와 API 를 같은 오리진으로 내보낸다. 브라우저는
// http://127.0.0.1:5399/ 만 열면 되고, 쿠키·CORS 문제가 생기지 않는다(노트북 모드).
// 프런트엔드는 VITE_API_BASE 를 프록시로 향하게 띄운다:
//   VITE_API_BASE=http://127.0.0.1:5399 npm run dev
// WebSocket 업그레이드는 /ws 는 백엔드로, 나머지(Vite HMR)는 FRONT_TARGET 으로 넘긴다.
import http from 'node:http';
import net from 'node:net';

const PROXY_PORT = Number(process.env.PROXY_PORT ?? 5399);
const target = new URL(process.env.TARGET ?? 'http://127.0.0.1:5311');
const DROP_NTH = Number(process.env.DROP_NTH ?? 1);
const front = process.env.FRONT_TARGET ? new URL(process.env.FRONT_TARGET) : null;
const MESSAGE_POST = /^\/api\/chats\/[^/]+\/messages$/;

const isBackendPath = (url = '') => /^\/(api\/|health(\?|$)|ws(\?|$))/.test(url);
const pick = (url) => (front && !isBackendPath(url) ? front : target);

let messagePosts = 0;

const server = http.createServer((req, res) => {
  const isMessagePost = req.method === 'POST' && MESSAGE_POST.test(req.url ?? '');
  const dropThis = isMessagePost && ++messagePosts === DROP_NTH;

  const dest = pick(req.url);
  const upstream = http.request(
    { host: dest.hostname, port: dest.port, method: req.method, path: req.url, headers: req.headers },
    (up) => {
      if (dropThis) {
        // 백엔드는 이미 응답을 만들었다(= 저장 완료). 그 응답을 버리고 브라우저 쪽 소켓을 끊는다.
        up.resume();
        console.log(`[drop] ${req.method} ${req.url} → 백엔드 ${up.statusCode}, 브라우저에는 전달하지 않음`);
        // 이 소켓은 첫 요청이라(Connection: close 덕분) 브라우저가 재전송하지 않고 네트워크 오류로 본다.
        res.socket?.destroy();
        return;
      }
      // keep-alive 소켓을 재사용하지 않게 한다. Chrome 은 재사용 소켓이 응답 없이 끊기면 POST 도
      // 조용히 한 번 더 보내는데(같은 clientKey → 서버가 중복 제거), 그러면 "실패"가 화면에 안 뜬다.
      res.writeHead(up.statusCode ?? 502, { ...up.headers, connection: 'close' });
      up.pipe(res);
    },
  );
  upstream.on('error', (err) => {
    console.log(`[error] ${req.method} ${req.url}: ${err.message}`);
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
  if (isMessagePost && !dropThis) console.log(`[pass] ${req.method} ${req.url} (${messagePosts}번째 전송)`);
});

// WebSocket 업그레이드는 TCP 그대로 넘긴다(/ws 는 백엔드, 그 외는 Vite HMR).
server.on('upgrade', (req, socket, head) => {
  const dest = pick(req.url);
  const up = net.connect(Number(dest.port), dest.hostname, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log(`fault-proxy: http://127.0.0.1:${PROXY_PORT} → ${target.origin}${front ? ` (그 외 경로 → ${front.origin})` : ''}`);
  console.log(`메시지 전송 ${DROP_NTH}번째 요청의 응답을 끊습니다. 프런트엔드는 VITE_API_BASE=http://127.0.0.1:${PROXY_PORT} 로 띄우세요.`);
});
