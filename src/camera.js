// 카메라 시점 두 가지 (버튼으로 전환).
// - follow: 걸어가는 햄스터를 부드럽게 따라감. 사용자가 돌려 둔 각도는 그대로 두고 함께 옮김
// - room:   방 전체를 내려다보는 고정 시점
// 모드를 바꾸면 1초 동안 카메라가 부드럽게 옮겨감.
import * as THREE from 'three';
import { FLOOR_Y } from './hamster.js';

const FOLLOW_OFFSET = new THREE.Vector3(3.0, 1.3, 4.4);
const ROOM_VIEW = { pos: new THREE.Vector3(0, 11, 13.5), target: new THREE.Vector3(0, FLOOR_Y, 0) }; // 매트 전체가 들어오게
const ease = (x) => x * x * (3 - 2 * x);

export function createCameraModes({ camera, controls, walker, button }) {
  const cam = { mode: 'follow', t: 1 };
  const fromPos = new THREE.Vector3(), fromTarget = new THREE.Vector3();
  const goalPos = new THREE.Vector3(), goalTarget = new THREE.Vector3();
  const prev = walker.position.clone(), move = new THREE.Vector3();

  function setMode(mode) {
    cam.mode = mode; cam.t = 0;
    fromPos.copy(camera.position); fromTarget.copy(controls.target);
    if (button) button.textContent = mode === 'room' ? '방 전체' : '따라가기';
  }
  button?.addEventListener('click', () => setMode(cam.mode === 'follow' ? 'room' : 'follow'));

  return {
    get mode() { return cam.mode; },
    // liftY: 들어올린 높이 (따라가기에서 들린 햄스터 쪽으로 시선을 조금 올림)
    update(dt, liftY = 0) {
      if (cam.mode === 'follow') {
        goalTarget.copy(walker.position); goalTarget.y += liftY * 0.6;
        goalPos.copy(goalTarget).add(FOLLOW_OFFSET);
      } else {
        goalTarget.copy(ROOM_VIEW.target); goalPos.copy(ROOM_VIEW.pos);
      }
      if (cam.t < 1) {
        // 모드 바꾸는 중: 시작 위치에서 목표 시점으로 부드럽게
        cam.t = Math.min(1, cam.t + dt);
        const k = ease(cam.t);
        camera.position.lerpVectors(fromPos, goalPos, k);
        controls.target.lerpVectors(fromTarget, goalTarget, k);
      } else if (cam.mode === 'follow') {
        // 햄스터가 움직인 만큼 카메라와 바라보는 점을 함께 옮김
        move.copy(walker.position).sub(prev);
        camera.position.add(move); controls.target.add(move);
        controls.target.lerp(goalTarget, Math.min(1, dt * 3));
      }
      prev.copy(walker.position);
    },
  };
}
