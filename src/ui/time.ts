const pad = (n: number) => String(n).padStart(2, '0');

/** 오후 6:05 형태. 카카오톡 표기를 따른다. */
export const clockLabel = (at: number): string => {
  const d = new Date(at);
  const h = d.getHours();
  const half = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${half} ${h12}:${pad(d.getMinutes())}`;
};

const startOfDay = (at: number): number => {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const sameDay = (a: number, b: number): boolean => startOfDay(a) === startOfDay(b);

export const dayLabel = (at: number): string => {
  const today = startOfDay(Date.now());
  const day = startOfDay(at);
  const diff = Math.round((today - day) / 86_400_000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '어제';
  const d = new Date(at);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

/** 채팅 목록용: 오늘이면 시각, 아니면 날짜. */
export const listTimeLabel = (at: number): string =>
  sameDay(at, Date.now()) ? clockLabel(at) : dayLabel(at);
