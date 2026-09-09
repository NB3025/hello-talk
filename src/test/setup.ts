import '@testing-library/dom';

// jsdom 은 BroadcastChannel 을 제공하지 않을 수 있다. 저장소가 그 부재를 견디는지는
// localRepository 쪽에서 이미 분기하지만, 테스트에서 실수로 의존하지 않도록 여기서도 남겨둔다.
if (typeof globalThis.BroadcastChannel === 'undefined') {
  // eslint-disable-next-line no-console
  console.info('BroadcastChannel 없음 — storage 이벤트 경로로 동작합니다.');
}
