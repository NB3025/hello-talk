import { useEffect, useRef, type ReactNode } from 'react';

/**
 * B안의 주력 표면. 새 목적지를 만들지 않고 현재 화면 위에 얹는다는 것이
 * 이 변형의 전제라, 시트가 곧 기능의 집이다.
 */
export function Sheet({
  title,
  lead,
  onClose,
  children,
}: {
  title: string;
  lead?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // 시트가 열리면 첫 입력 요소로 초점을 옮긴다 — 키보드만 쓰는 사용자에게 필요하다.
    panel.current?.querySelector<HTMLElement>('input, textarea, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheetwrap">
      <button className="scrim" aria-label="닫기" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={panel}>
        <div className="grab" />
        <button className="close" onClick={onClose} aria-label="닫기">
          {/* ✕(U+2715) 는 리눅스 기본 폰트 집합에 없어 □ 로 렌더된다. ×(U+00D7) 는 있다. */}
          ×
        </button>
        <h2>{title}</h2>
        {lead ? <p className="lead">{lead}</p> : null}
        {children}
      </div>
    </div>
  );
}
