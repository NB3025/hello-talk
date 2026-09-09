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

export function StoreProvider({
  children,
  repository,
}: {
  children: ReactNode;
  /** 테스트에서 인메모리 구현을 넣을 수 있게 뚫어둔다. */
  repository?: Repository;
}) {
  const repo = useMemo<Repository>(
    () => repository ?? new LocalRepository(window.localStorage),
    [repository],
  );

  const db = useSyncExternalStore(
    useCallback((cb: () => void) => repo.subscribe(cb), [repo]),
    useCallback(() => repo.snapshot(), [repo]),
  );

  const [meId, setMeId] = useState<UserId | null>(readMe);

  const signIn = useCallback((id: UserId) => {
    try {
      sessionStorage.setItem(ME_KEY, id);
    } catch {
      /* 시크릿 모드 등에서 막히면 메모리에만 유지한다 */
    }
    setMeId(id);
  }, []);

  const signOut = useCallback(() => {
    try {
      sessionStorage.removeItem(ME_KEY);
    } catch {
      /* 무시 */
    }
    setMeId(null);
  }, []);

  // 저장소가 초기화되면 남아 있던 내 id 가 가리키는 사람이 사라진다. 그때는 로그아웃한다.
  const me = meId ? userById(db, meId) ?? null : null;
  useEffect(() => {
    if (meId && !me) signOut();
  }, [meId, me, signOut]);

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
