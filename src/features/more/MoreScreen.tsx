import { useStore } from '../../store/StoreProvider';
import { Avatar } from '../../ui/Avatar';
import { pendingGifts, usableGifts } from '../../domain/gift';
import type { User } from '../../domain/types';
import type { GiftTab } from '../gift/GiftApp';

/**
 * 레퍼런스 더보기 탭(`references/gift/NOTES.md` 5번 화면)의 4열 아이콘 그리드를 따른다.
 * 실제 카카오톡도 선물하기·받은선물·캘린더가 이 그리드 안에 나란히 있고, 그것이
 * B안에서 이 둘을 더보기 안쪽에 둔 판단과 일치한다.
 */
export function MoreScreen({
  me,
  onOpenGift,
}: {
  me: User;
  onOpenGift: (tab: GiftTab) => void;
}) {
  const { db, repo, signOut } = useStore();
  const now = Date.now();
  const usable = usableGifts(db, me.id, now).length;
  const pending = pendingGifts(db, me.id, now).length;

  return (
    <>
      <div className="topbar">
        <h1>더보기</h1>
      </div>
      <div className="screen">
        <div className="mecard">
          <Avatar user={me} size={48} />
          <div className="body">
            <div className="nm">{me.name}</div>
            <div className="st">{me.code}</div>
          </div>
          <button className="pill" onClick={signOut}>
            계정 전환
          </button>
        </div>

        <div className="iconcard">
          <div className="icongrid">
            <button onClick={() => onOpenGift('home')}>
              <span className="ic" aria-hidden="true">
                🎁
              </span>
              선물하기
            </button>
            <button onClick={() => onOpenGift('box')}>
              <span className="ic" aria-hidden="true">
                🎟
              </span>
              {pending + usable > 0 ? <span className="dot" aria-hidden="true" /> : null}
              받은선물
            </button>
            <button onClick={() => onOpenGift('box')}>
              <span className="ic" aria-hidden="true">
                📤
              </span>
              보낸선물
            </button>
            <button onClick={() => onOpenGift('my')}>
              <span className="ic" aria-hidden="true">
                🧾
              </span>
              주문내역
            </button>

            <Inert glyph="📅" label="캘린더" />
            <Inert glyph="😀" label="이모티콘" />
            <Inert glyph="🛍" label="쇼핑하기" />
            <Inert glyph="☁" label="톡클라우드" />
          </div>
        </div>

        <p className="note">
          {usable > 0
            ? `사용할 수 있는 선물이 ${usable}개 있습니다.`
            : pending > 0
              ? `응답을 기다리는 선물이 ${pending}개 있습니다.`
              : '받은 선물이 아직 없습니다. 친구 프로필의 🎁 선물하기로 먼저 보내보세요.'}
        </p>

        <div className="divider" />

        <p className="note">
          B안은 선물을 최상위 탭으로 올리지 않습니다. 하단 탭은 5개 그대로이고, 선물하기는 이
          그리드나 친구 프로필에서만 열립니다. 열린 뒤에는 실제 카카오톡처럼 자체 탭을 가진 전체
          화면으로 동작합니다 — 2열 상품 그리드가 시트 높이에서는 성립하지 않기 때문입니다.
          캘린더는 다음 슬라이스에서 이 자리에 붙습니다.
        </p>

        <div className="actionsrow">
          <button
            className="pill ghost"
            onClick={() => {
              const ok = window.confirm(
                '모든 사람·친구·대화·선물을 지우고 데모 상태로 되돌립니다. 되돌릴 수 없습니다. 계속할까요?',
              );
              if (ok) repo.reset();
            }}
          >
            데모 데이터로 초기화
          </button>
        </div>
      </div>
    </>
  );
}

/** 자리는 잡되 눌리지 않는 항목. 레퍼런스 그리드의 밀도가 정보 계층의 일부다. */
function Inert({ glyph, label }: { glyph: string; label: string }) {
  return (
    <button disabled title="이번 범위 밖입니다">
      <span className="ic" aria-hidden="true">
        {glyph}
      </span>
      {label}
    </button>
  );
}
