/**
 * 저장소 선택 설정.
 *
 * - VITE_API_BASE 가 있으면 그 주소의 백엔드에 붙는 ApiRepository 를 쓴다(운영/개발).
 * - 없으면 로컬 데모 모드(LocalRepository, localStorage).
 *
 * 테스트는 StoreProvider 의 `repository?` prop 으로 직접 구현을 주입하므로
 * 이 설정 경로를 타지 않는다.
 */

/** import.meta.env 를 안전하게 읽는다(테스트/노드 환경에서 없을 수 있다). */
const readEnv = (key: string): string | undefined => {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return env?.[key];
  } catch {
    return undefined;
  }
};

/** 설정된 API 베이스 URL. 없으면 null(로컬 데모 모드). */
export const apiBaseUrl = (): string | null => {
  const raw = readEnv('VITE_API_BASE');
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
};
