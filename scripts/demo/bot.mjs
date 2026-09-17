#!/usr/bin/env node
// hello-talk 1-6 시연용 상대 봇. 브라우저 하나로 시연할 수 있게 "상대방" 역할을 스크립트가 맡는다.
//
// 하는 일
//   1. 서버 API 로 봇 사용자를 만든다(이름 BOT_NAME). 로그인 화면의 "이미 있는 사람" 목록에도 나타난다.
//   2. 새로 생긴 사람을 모두 친구로 추가하고 1:1 방을 열어 먼저 인사한다. 사람은 채팅 탭에서 방만 열면 된다.
//   3. 받은 메시지마다 "N번째 메시지 받았어요: 「…」" 로 답한다. 바로 앞 메시지와 내용이 같으면
//      "방금 것과 같은 내용이네요. 두 번 보내셨나요?" 를 덧붙인다 → 재시도 중복이 사람의 화면에 그대로 보인다.
//   4. 받은 방은 읽음 처리한다(사람 화면에 '읽음' 이 뜬다).
//
// 봇은 장애 프록시를 거치지 않고 백엔드에 직접 붙는다. 실패는 사람의 브라우저에서만 일어나야 한다.
//
//   API=http://127.0.0.1:5311 node bot.mjs
//   BOT_NAME='밥 (봇)' POLL_MS=1500 node bot.mjs
//
// 백엔드는 DEV_TOOLS=1 이어야 한다(/api/dev/users 로 새 사람을 찾는다).
const API = (process.env.API ?? 'http://127.0.0.1:5311').replace(/\/$/, '');
const BOT_NAME = process.env.BOT_NAME ?? '밥 (봇)';
const POLL_MS = Number(process.env.POLL_MS ?? 1500);

let cookie = '';
const api = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) if (c.startsWith('ht_session=')) cookie = c.split(';')[0];
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};

const log = (...a) => console.log(`[bot ${new Date().toLocaleTimeString('ko-KR', { hour12: false })}]`, ...a);

// ── 1. 봇 사용자. 같은 이름의 봇이 이미 있으면 그 사람으로 다시 로그인한다(재시작해도 같은 봇, 기존 방이 이어진다) ──
const existing = (await api('GET', '/api/dev/users')).users.find((u) => u.name === BOT_NAME);
const { user: me } = existing
  ? await api('POST', '/api/auth/session', { userId: existing.id })
  : await api('POST', '/api/auth/session', { name: BOT_NAME, statusMessage: '테스트 봇 · 받은 메시지를 세어 답합니다' });
log(`${existing ? '다시 로그인' : '새로 만듦'}: ${me.name} (${me.code}, id ${me.id})`);
log(`브라우저에서 이름을 만들면 ${POLL_MS}ms 안에 봇이 친구 추가 + 먼저 인사합니다. 채팅 탭에서 방을 여세요.`);

const greeted = new Set(); // userId
const seen = new Set(); // messageId
const lastTextBy = new Map(); // `${chatId}:${senderId}` → text
let first = true;

// ── 2·3. 폴링 루프 ──────────────────────────────────────────────────────────
const tick = async () => {
  const { users } = await api('GET', '/api/dev/users');
  const { db } = await api('GET', '/api/snapshot');

  // 봇과 1:1 방이 아직 없는 사람에게 친구 추가 + 방 열기 + 인사. 재시작 뒤에는 이미 방이 있는 사람은 건너뛴다
  for (const c of db.chats) if (c.memberIds.includes(me.id)) for (const id of c.memberIds) greeted.add(id);
  for (const u of users) {
    if (u.id === me.id || greeted.has(u.id)) continue;
    greeted.add(u.id);
    await api('POST', '/api/friends', { code: u.code }).catch((e) => log(`친구 추가 실패 ${u.name}: ${e.message}`));
    const { chatId } = await api('POST', '/api/chats/direct', { targetId: u.id });
    await api('POST', `/api/chats/${chatId}/messages`, {
      text: `${u.name}님 안녕하세요, 저는 ${me.name}이에요. 메시지를 보내면 몇 번째로 받았는지 세어 답할게요.`,
      clientKey: `greet:${u.id}`,
    });
    log(`새 사람 ${u.name} (${u.code}) → 친구 추가, 방 ${chatId.slice(0, 8)} 열고 인사`);
  }

  // 받은 메시지에 답하기
  const myChats = db.chats.filter((c) => c.memberIds.includes(me.id));
  for (const chat of myChats) {
    const msgs = db.messages
      .filter((m) => m.chatId === chat.id && (m.kind ?? 'text') === 'text')
      .sort((a, b) => a.createdAt - b.createdAt);
    let replied = false;
    for (const m of msgs) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      if (first || m.senderId === me.id) continue;
      const n = msgs.filter((x) => x.senderId === m.senderId && x.createdAt <= m.createdAt && seen.has(x.id)).length;
      const key = `${chat.id}:${m.senderId}`;
      const dup = lastTextBy.get(key) === m.text;
      lastTextBy.set(key, m.text);
      const text = `${n}번째 메시지 받았어요: 「${m.text}」${dup ? ' — 방금 것과 같은 내용이네요. 두 번 보내셨나요?' : ''}`;
      await api('POST', `/api/chats/${chat.id}/messages`, { text, clientKey: `reply:${m.id}` });
      log(`방 ${chat.id.slice(0, 8)} ← "${m.text}" (${n}번째${dup ? ', 중복' : ''}) → 답장`);
      replied = true;
    }
    if (replied) await api('POST', `/api/chats/${chat.id}/read`).catch(() => {});
  }
  first = false;
};

for (;;) {
  try {
    await tick();
  } catch (e) {
    log(`오류: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
