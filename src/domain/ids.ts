/** 0/O, 1/I/L 처럼 손으로 옮겨 적을 때 틀리는 글자를 뺀 알파벳. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const randomInts = (n: number): number[] => {
  const buf = new Uint32Array(n);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < n; i += 1) buf[i] = Math.floor(Math.random() * 0xffffffff);
  }
  return Array.from(buf);
};

export const newId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return randomInts(4).map((n) => n.toString(16)).join('-');
};

/** HT-XXXX 형태. 사람이 소리내어 읽고 상대가 입력할 수 있어야 한다. */
export const newFriendCode = (): string => {
  const body = randomInts(4)
    .map((n) => CODE_ALPHABET[n % CODE_ALPHABET.length])
    .join('');
  return `HT-${body}`;
};

const HUES = [
  '#F6C1B4', '#C7D8EA', '#D9CBEF', '#FBDFA4',
  '#BFE3C9', '#F0C7D9', '#CFCFD6', '#EAD9C0',
];

/** 이름에서 결정론적으로 뽑는다 — 같은 사람은 어느 화면에서나 같은 색. */
export const hueFor = (seed: string): string => {
  const sum = [...seed].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return HUES[sum % HUES.length] as string;
};
