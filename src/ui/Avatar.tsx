import type { User } from '../domain/types';

const initial = (name: string): string => {
  const letters = name.replace(/[^가-힣A-Za-z0-9]/g, '');
  return letters.slice(0, 1) || '·';
};

export function Avatar({ user, size = 44 }: { user: User; size?: number }) {
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        background: user.hue,
        fontSize: Math.round(size * 0.36),
        borderRadius: Math.round(size * 0.36),
      }}
      aria-hidden="true"
    >
      {initial(user.name)}
    </div>
  );
}
