import { useState } from 'react';
import { Avatar } from '../../ui/Avatar';
import { useStore } from '../../store/StoreProvider';

export function LoginScreen() {
  const { db, repo, signIn } = useStore();
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const user = repo.createUser(name, status);
    signIn(user.id);
  };

  const people = [...db.users].sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div className="screen">
      <div className="login">
        <div className="mark" aria-hidden="true">
          💬
        </div>
        <h1>hello-talk</h1>
        <p className="lead">
          누구로 들어갈지 고르세요. 탭을 두 개 열어 서로 다른 사람으로 로그인하면 두 사람이 실제로
          대화할 수 있습니다.
        </p>

        <form onSubmit={create}>
          <label className="field plain">
            <span className="label">새로 시작하기 — 이름</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 홍길동"
              maxLength={20}
              autoComplete="off"
            />
          </label>
          <label className="field plain">
            <span className="label">상태 메시지 (선택)</span>
            <input
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="예: 오늘도 화이팅"
              maxLength={40}
              autoComplete="off"
            />
          </label>
          <div className="actionsrow">
            <button className="pill solid" type="submit" disabled={!name.trim()}>
              이 이름으로 시작
            </button>
          </div>
        </form>

        <div className="section" style={{ paddingLeft: 0 }}>
          <b>이미 있는 사람으로 들어가기</b> {people.length}
        </div>
        <div className="who">
          {people.map((u) => (
            <button key={u.id} onClick={() => signIn(u.id)}>
              <Avatar user={u} size={40} />
              <div className="body">
                <div className="nm">{u.name}</div>
                <div className="cd">{u.code}</div>
              </div>
              <span aria-hidden="true" style={{ color: '#c2c2c7' }}>
                ›
              </span>
            </button>
          ))}
        </div>

        <p className="hint">
          저장은 이 브라우저 안에서만 일어납니다. 서버가 없으므로 다른 기기에서는 보이지 않고,
          브라우저 데이터를 지우면 함께 사라집니다.
        </p>
      </div>
    </div>
  );
}
