// 목덜미 잡고 들어올리기: 목덜미를 잡아 위로 끌어올리면 그 점에 매달려 몸이 아래로 축 늘어진다.
//
// hanger 그룹(walker와 body 사이)을 목덜미 점을 축으로 돌리고 들어올린다.
// - amount: 매달린 정도 0~1 (들어올린 높이에 따라 서서히 세로로 늘어짐)
// - 커서를 좌우로 움직이면 진자처럼 흔들리다 잦아듦
// - 놓으면 떨어져서 바닥에 내려앉고, 들려 있던 곳(가로 위치)에 그대로 내려옴
import * as THREE from 'three';

const LIFT_START = 0.3;    // 목덜미를 이만큼 위로 끌어야 들림
const HANG_FULL = 0.7;     // 이만큼 더 들면 완전히 세로로 매달림
const HANG_ANGLE = -1.25;  // 완전히 매달렸을 때 몸을 세우는 각도 (머리 위, 엉덩이 아래)
const GRAVITY = 9;

// 목덜미: 머리 뒤 등 위쪽부터 정수리까지 (몸 좌표). 앞쪽으로 갈수록 더 높은 곳만 쳐서 눈·이마 아래는 빠짐
export const isScruff = (p) => p.z > -0.25 && p.z < 1.0 && Math.abs(p.x) < 0.42 && p.y > 0.3 + Math.max(0, p.z - 0.45) * 0.75;

export function createHang(hanger) {
  const st = {
    slot: -1, active: false, amount: 0,
    pivot: new THREE.Vector3(),       // 목덜미 점 (walker 좌표)
    lift: new THREE.Vector3(),        // 들어올린 양 (walker 좌표)
    target: new THREE.Vector3(),      // 커서가 끌고 있는 목표 위치 (walker 좌표)
    fallVel: 0, swing: 0, swingVel: 0, lastX: null,
  };
  const R = new THREE.Quaternion(), qx = new THREE.Quaternion(), qz = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1), tmp = new THREE.Vector3();

  return {
    get active() { return st.active; },
    get amount() { return st.amount; },
    get lift() { return st.lift; },
    get slot() { return st.slot; },

    // 잡기 시작: 목덜미면 매달기 후보로 기억
    grab(slot, pivotWalker) { st.slot = slot; st.pivot.copy(pivotWalker); st.target.copy(pivotWalker); st.lastX = null; },
    // 끌기: 목표 위치 갱신, 충분히 들어올리면 매달림
    drag(slot, pointWalker) {
      if (slot !== st.slot) return;
      st.target.copy(pointWalker);
      if (!st.active && pointWalker.y - st.pivot.y > LIFT_START) { st.active = true; st.fallVel = 0; }
      if (st.lastX !== null) st.swingVel += (pointWalker.x - st.lastX) * 6; // 좌우로 움직이면 흔들림
      st.lastX = pointWalker.x;
    },
    // 놓기: 들려 있으면 떨어짐. 가로로 옮긴 만큼은 walker로 넘겨서 그 자리에 내려앉음. 돌려주는 값: 옮길 가로 거리(walker 좌표)
    release(slot) {
      if (slot !== st.slot) return null;
      st.slot = -1;
      const wasActive = st.active;
      st.active = false;
      if (!wasActive) return null;
      const moved = new THREE.Vector3(st.lift.x, 0, st.lift.z);
      st.lift.x = 0; st.lift.z = 0;
      return moved;
    },

    update(dt) {
      if (st.active) {
        // 목덜미가 커서를 따라가게
        tmp.copy(st.target).sub(st.pivot);
        tmp.y = Math.max(0, tmp.y - LIFT_START * 0.5);
        st.lift.lerp(tmp, Math.min(1, dt * 12));
        st.amount += (Math.min(1, Math.max(0, (st.lift.y - LIFT_START * 0.5) / HANG_FULL)) - st.amount) * Math.min(1, dt * 6);
      } else {
        // 떨어지기 + 바로 서기
        if (st.lift.y > 0 || st.fallVel !== 0) {
          st.fallVel -= GRAVITY * dt;
          st.lift.y += st.fallVel * dt;
          if (st.lift.y <= 0) { st.lift.y = 0; st.fallVel = Math.abs(st.fallVel) > 1.2 ? -st.fallVel * 0.2 : 0; }
        }
        st.amount = Math.max(0, st.amount - dt * 4);
      }
      // 진자 흔들림 (잦아듦)
      st.swingVel += (-30 * st.swing - 2.5 * st.swingVel) * dt;
      st.swing = THREE.MathUtils.clamp(st.swing + st.swingVel * dt, -0.6, 0.6) * (st.active ? 1 : 0.9);

      // hanger: 목덜미 점을 축으로 돌리고(세우기 + 흔들기) 들어올림
      qz.setFromAxisAngle(Z, st.swing * st.amount);
      qx.setFromAxisAngle(X, HANG_ANGLE * st.amount);
      R.copy(qz).multiply(qx);
      hanger.quaternion.copy(R);
      hanger.position.copy(st.pivot).sub(tmp.copy(st.pivot).applyQuaternion(R)).add(st.lift);
    },
  };
}
