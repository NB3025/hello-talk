import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { Db, User, UserId } from '../domain/types';
import { userById } from '../domain/selectors';
import { LocalRepository } from './localRepository';
import { ApiRepository } from './apiRepository';
import { apiBaseUrl } from './config';
import type { Repository } from './repository';

const ME_KEY = 'hello-talk/me';

interface StoreValue {
  repo: Repository;
  db: Db;
  me: User | null;
  signIn: (id: UserId) => void;
  signOut: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

/** 탭마다 다른 값을 갖는다. 이게 "탭 두 개 = 두 사람"을 만드는 부분이다. */
const readMe = (): UserId | null => {
  try {
    return sessionStorage.getItem(ME_KEY);
  } catch {
    return null;
  }
};

/**
 * 서버 세션을 세우고/닫는 부가 기능은 Repository의 데이터 계약과 분리한다.
 */
interface SessionAware {
  signInExisting(userId: UserId): Promise<User | null>;
  currentUser(): Promise<User | null>;
  signOutSession(): Promise<void>;
  subscribeSessionExpired(listener: () => void): () => void;
}

const asSessionAware = (repo: Repository): SessionAware | null => {
  const maybe = repo as unknown as Partial<SessionAware>;
  return typeof maybe.signInExisting === 'function' &&
    typeof maybe.currentUser === 'function' &&
    typeof maybe.signOutSession === 'function' &&
    typeof maybe.subscribeSessionExpired === 'function'
    ? (repo as unknown as SessionAware)
    : null;
};

const defaultRepository = (): Repository => {
  const base = apiBaseUrl();
  if (base) return new ApiRepository({ baseUrl: base });
  return new LocalRepository(window.localStorage);
};

export function StoreProvider({
  children,
  repository,
}: {
  children: ReactNode;
  /** 테스트에서 인메모리 구현을 넣을 수 있게 뚫어둔다. */
  repository?: Repository;
}) {
  const repo = useMemo<Repository>(() => repository ?? defaultRepository(), [repository]);
  const session = useMemo(() => asSessionAware(repo), [repo]);

  const db = useSyncExternalStore(
    useCallback((cb: () => void) => repo.subscribe(cb), [repo]),
    useCallback(() => repo.snapshot(), [repo]),
  );

  const [meId, setMeId] = useState<UserId | null>(readMe);

  const signIn = useCallback(
    (id: UserId) => {
      try {
        sessionStorage.setItem(ME_KEY, id);
      } catch {
        /* 시크릿 모드 등에서 막히면 메모리에만 유지한다 */
      }
      setMeId(id);
      // 신규 생성 직후에는 createUser 가 이미 쿠키 세션을 세웠다. 먼저 현재 세션을 확인하고,
      // 다른 사용자 선택일 때만 dev 전용 기존 사용자 로그인 경로를 호출한다.
      if (session) {
        void session.currentUser().then((current) => {
          if (current?.id !== id) return session.signInExisting(id);
          return current;
        });
      }
    },
    [session],
  );

  const clearLocalSession = useCallback(() => {
    try {
      sessionStorage.removeItem(ME_KEY);
    } catch {
      /* 무시 */
    }
    setMeId(null);
  }, []);

  const signOut = useCallback(() => {
    clearLocalSession();
    if (session) void session.signOutSession();
  }, [clearLocalSession, session]);

  useEffect(() => {
    if (!session) return;
    return session.subscribeSessionExpired(clearLocalSession);
  }, [session, clearLocalSession]);

  // 새로고침 후 서버 세션이 살아 있으면 me 를 복원한다.
  useEffect(() => {
    if (!session) return;
    if (meId) return;
    let alive = true;
    void session.currentUser().then((user) => {
      if (!alive || !user) return;
      try {
        sessionStorage.setItem(ME_KEY, user.id);
      } catch {
        /* 무시 */
      }
      setMeId(user.id);
    });
    return () => {
      alive = false;
    };
  }, [session, meId]);

  // 저장소가 초기화되면 남아 있던 내 id 가 가리키는 사람이 사라진다. 그때는 로그아웃한다.
  // 단, 서버 모드에서는 스냅샷이 아직 하이드레이트되기 전일 수 있으므로 성급히 로그아웃하지 않는다.
  const me = meId ? userById(db, meId) ?? null : null;
  useEffect(() => {
    if (meId && !me && !session) signOut();
  }, [meId, me, session, signOut]);

  const value = useMemo<StoreValue>(
    () => ({ repo, db, me, signIn, signOut }),
    [repo, db, me, signIn, signOut],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(StoreContext);
  if (!v) throw new Error('useStore 는 StoreProvider 안에서만 쓸 수 있습니다.');
  return v;
}

/** 로그인이 이미 확인된 화면에서 me 의 null 체크를 반복하지 않도록. */
export function useMe(): User {
  const { me } = useStore();
  if (!me) throw new Error('로그인 후에만 쓸 수 있습니다.');
  return me;
}
