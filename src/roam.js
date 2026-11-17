// 돌아다니기: 만지지 않을 때 햄스터가 혼자 하는 행동을 고른다.
//
// - rest:   앉아서 쉼 (2~5초)
// - wander: 방 안의 아무 곳을 골라 걸어감
// - sniff:  멈춰서 고개를 숙이고 바닥을 킁킁거림 (2~3.5초)
// - follow: 바닥 위에서 움직이는 마우스를 따라감. 가까이 가면 멈추고 마우스 쪽을 바라봄
//
// 쓰다듬거나 잡거나 엎드리거나 성질낼 때는 그 자리에 멈춘다(rest).
// update()는 이번 프레임의 { speed, faceTo, nod, sniff }를 돌려준다.
//   speed: 걷는 속도(0이면 멈춤), faceTo: 바라볼 바닥 위 점(없으면 null), nod: 고개 숙임 정도(0~1), sniff: 코 실룩임(0~1)
import * as THREE from 'three';

const WANDER_SPEED = 0.5, FOLLOW_SPEED = 0.75;
const ARRIVE_DIST = 0.3, FOLLOW_STOP = 0.9;   // 목표에 도착했다고 보는 거리, 마우스 앞에서 멈추는 거리
const MOUSE_FRESH = 1.5;                       // 마우스가 멈춘 뒤 이 시간(초)까지는 계속 따라감
const rand = (a, b) => a + Math.random() * (b - a);

export function createRoamer({ roomRadius }) {
  const st = { mode: 'rest', timer: rand(1, 3), target: new THREE.Vector3(), nod: 0 };
  const mouse = { point: new THREE.Vector3(), age: Infinity };

  function pickWanderTarget(from) {
    // 방 안의 아무 곳 (가장자리에서는 조금 떨어지게). 너무 가까운 곳은 다시 고름
    const r = roomRadius - 0.9;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
      st.target.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      if (st.target.distanceTo(from) > 1.0) break;
    }
  }
  function next(mode, from) {
    st.mode = mode;
    if (mode === 'rest') st.timer = rand(2, 5);
    if (mode === 'sniff') st.timer = rand(2, 3.5);
    if (mode === 'wander') { st.timer = 12; pickWanderTarget(from); }
  }
  // 쉬고 나서: 돌아다니기 60%, 킁킁 25%, 더 쉬기 15%
  const afterRest = (from) => { const r = Math.random(); next(r < 0.6 ? 'wander' : r < 0.85 ? 'sniff' : 'rest', from); };

  return {
    get mode() { return st.mode; },

    // 바닥 위 마우스 위치 (햄스터 위가 아닐 때)
    seeMouse(point) {
      if (point.length() > roomRadius - 0.4) point.setLength(roomRadius - 0.4); // 방 밖이면 가장자리까지만
      mouse.point.copy(point); mouse.age = 0;
    },

    update(dt, { pos, enabled, busy }) {
      mouse.age += dt;
      let speed = 0, faceTo = null, nodTarget = 0, sniff = 0;

      if (!enabled || busy) {
        // 만지는 중이면 멈추고, 손이 떠나면 잠시 쉬었다가 다시 움직임
        if (st.mode !== 'rest' || st.timer < 2) { st.mode = 'rest'; st.timer = 2.5; }
        st.timer = Math.max(st.timer, 1);
      } else if (mouse.age < MOUSE_FRESH) {
        // 마우스 따라가기 (다른 행동보다 먼저)
        st.mode = 'follow';
        faceTo = mouse.point;
        if (pos.distanceTo(mouse.point) > FOLLOW_STOP) speed = FOLLOW_SPEED;
      } else {
        if (st.mode === 'follow') next('rest', pos);
        st.timer -= dt;
        if (st.mode === 'rest') {
          if (st.timer <= 0) afterRest(pos);
        } else if (st.mode === 'sniff') {
          nodTarget = 1; sniff = 1;
          if (st.timer <= 0) next('rest', pos);
        } else if (st.mode === 'wander') {
          faceTo = st.target;
          const d = pos.distanceTo(st.target);
          speed = WANDER_SPEED * Math.min(1, d / 0.6); // 도착할 때쯤 천천히
          if (d < ARRIVE_DIST || st.timer <= 0) next(Math.random() < 0.5 ? 'sniff' : 'rest', pos);
        }
      }
      st.nod += (nodTarget - st.nod) * Math.min(1, dt * 4);
      return { speed, faceTo, nod: st.nod, sniff };
    },
  };
}
