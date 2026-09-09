import { hueFor, newId } from '../domain/ids';
import type { User } from '../domain/types';

/**
 * 빈 앱에서는 친구 등록을 시험할 상대가 없다. 그래서 코드가 고정된 데모 사용자를 심는다.
 * 코드는 화면(친구 추가 시트)에 그대로 안내하므로 문서와 어긋나지 않게 여기서만 관리한다.
 *
 * 이름은 **누가 봐도 가명인 것만 쓴다.** 홍길동·김철수·이영희는 한국에서 예시용으로
 * 통용되는 이름이고, 실제 인물에서 따오지 않았다. 레퍼런스 스크린샷에 찍힌 사람의 이름을
 * 데모 데이터에 옮기면 그 사람의 개인정보가 리포에 남는다 — 그런 일이 생기지 않도록
 * 데모 이름은 이 파일에서만 정하고, 실제 화면에서 베끼지 않는다.
 */
const DEMO: Array<Pick<User, 'name' | 'code' | 'statusMessage'>> = [
  { name: '홍길동', code: 'HT-GDNG', statusMessage: '판교 출근중' },
  { name: '김철수', code: 'HT-CHSU', statusMessage: '커피 마시는 중 ☕' },
  { name: '이영희', code: 'HT-YHEE', statusMessage: '오늘 생일이에요 🎂' },
  { name: '박영수', code: 'HT-YSPK', statusMessage: '오늘도 화이팅' },
];

export const DEMO_CODES = DEMO.map(({ name, code }) => ({ name, code }));

export const seedUsers = (): User[] => {
  const base = Date.now();
  return DEMO.map((d, i) => ({
    id: newId(),
    code: d.code,
    name: d.name,
    statusMessage: d.statusMessage,
    hue: hueFor(d.name + d.code),
    createdAt: base + i,
  }));
};
