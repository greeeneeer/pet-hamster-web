// 방: 햄스터가 돌아다니는 둥근 바닥 매트와, 햄스터를 따라다니는 그림자.
import * as THREE from 'three';
import { FLOOR_Y } from './hamster.js';

export const ROOM_R = 4.5;

// 점이 매트 밖으로 나가지 않게 (가장자리에서 margin만큼 안쪽까지)
export function keepInRoom(p, margin = 0.4) {
  if (p.length() > ROOM_R - margin) p.setLength(ROOM_R - margin);
  return p;
}

function radialTexture(size, stops) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), h = size / 2, grd = g.createRadialGradient(h, h, 0, h, h, h);
  for (const [at, color] of stops) grd.addColorStop(at, color);
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createStage(scene, walker) {
  // 바닥 매트: 가장자리는 배경으로 스며들게
  const matTex = radialTexture(512, [[0, 'rgba(236,217,186,1)'], [0.85, 'rgba(232,212,180,0.9)'], [1, 'rgba(232,212,180,0)']]);
  const floorMat = new THREE.Mesh(
    new THREE.CircleGeometry(ROOM_R, 96),
    new THREE.MeshBasicMaterial({ map: matTex, transparent: true, depthWrite: false, toneMapped: false }),
  );
  floorMat.rotation.x = -Math.PI / 2;
  floorMat.position.y = FLOOR_Y - 0.012;
  floorMat.renderOrder = -1;
  scene.add(floorMat);

  // 그림자: 햄스터를 따라다님 (walker 안)
  const shadowTex = radialTexture(256, [[0.04, 'rgba(70,45,20,0.45)'], [1, 'rgba(70,45,20,0)']]);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.4), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = FLOOR_Y - 0.005;
  walker.add(shadow);

  return {
    // 들려 있으면 그림자가 작아지고, 들린 자리(가로) 아래로 옮겨감
    update(lift) {
      shadow.scale.setScalar(1 / (1 + lift.y * 0.8));
      shadow.position.set(lift.x, FLOOR_Y - 0.005, lift.z);
    },
  };
}
