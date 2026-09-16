import { useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { useStore } from '../../store/StoreProvider';
import { DEMO_CODES } from '../../store/seed';
import type { User } from '../../domain/types';

type Outcome = { kind: 'ok'; friend: User } | { kind: 'bad'; reason: string } | null;

export function AddFriendSheet({ me, onClose }: { me: User; onClose: () => void }) {
  const { repo } = useStore();
  const [code, setCode] = useState('');
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await repo.addFriendByCode(me.id, code);
      if (result.ok) {
        setOutcome({ kind: 'ok', friend: result.friend });
        setCode('');
      } else {
        setOutcome({ kind: 'bad', reason: result.reason });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="친구 추가"
      lead="상대의 친구 코드를 입력하면 내 친구 목록에 담깁니다."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <label className="field">
          <span className="label">친구 코드</span>
          <input
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setOutcome(null);
            }}
            placeholder="HT-XXXX"
            maxLength={12}
            autoComplete="off"
            spellCheck={false}
            aria-label="친구 코드"
          />
        </label>

        {outcome?.kind === 'bad' ? (
          <p className="note bad" role="alert">
            {outcome.reason}
          </p>
        ) : null}
        {outcome?.kind === 'ok' ? (
          <p className="note good" role="status">
            {outcome.friend.name} 님을 친구로 추가했습니다. 이어서 다른 코드를 입력해도 됩니다.
          </p>
        ) : null}

        <p className="note">
          내 코드는 <code>{me.code}</code> 입니다. 시험해 볼 데모 계정 코드:{' '}
          {DEMO_CODES.map((d, i) => (
            <span key={d.code}>
              {i > 0 ? ', ' : ''}
              {d.name} <code>{d.code}</code>
            </span>
          ))}
        </p>

        <div className="actionsrow">
          <button className="pill" type="button" onClick={onClose}>
            닫기
          </button>
          <button className="pill solid" type="submit" disabled={!code.trim() || busy}>
            {busy ? '확인 중…' : '추가'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
