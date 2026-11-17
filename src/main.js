// 장면 구성과 매 프레임 갱신.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildBodyGeometry, buildParts, FLOOR_Y, EYE_SCALE } from './hamster.js';
import { createFur } from './fur.js';
import { createSoftBody, posePos, poseAngle } from './softbody.js';
import { createPetting } from './petting.js';
import { createMood } from './mood.js';
import { sound } from './sound.js';

// ── 렌더러 · 카메라 · 조명 ─────────────────────────
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25)); // 털은 픽셀마다 여러 겹을 그리므로 배율을 제한 (발열 줄이기)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
camera.position.set(3.0, 1.3, 4.4);

const key = new THREE.DirectionalLight(0xfff2e0, 2.2);
key.position.set(-2, 4, 3);
scene.add(key, new THREE.HemisphereLight(0xfff8ee, 0xb89a78, 0.6));

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.0, 0.05);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 2.5;
controls.maxDistance = 8;
controls.maxPolarAngle = Math.PI - 0.05; // 바닥 아래로 내려가 밑에서 올려다보기 가능
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }; // 왼쪽은 쓰다듬기용
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }; // 한 손가락: 햄스터 밖이면 돌려보기(petting.js가 조절), 두 손가락: 확대·축소 (이동은 꺼져 있음)

// ── 햄스터 ─────────────────────────────────────────
// body(고개 돌리기) 안에 털 메시들, 몸에 붙는 부위들, 클릭 판정용 메시가 들어간다.
const body = new THREE.Group();
scene.add(body);

const bodyGeo = buildBodyGeometry();
const parts = buildParts();
const soft = createSoftBody();
const fur = createFur(bodyGeo, parts.anchors, soft);
const partList = parts.group.children;
body.add(
  fur.mesh, parts.group,
  fur.addLimbFur(partList.filter((o) => o.userData.limb)),
  fur.addLimbFur(partList.filter((o) => o.userData.tail), { furScale: 0.6, tail: true }), // 꼬리: 더 짧은 흰 털
);

// 클릭 판정용 메시: 엎드린 자세를 CPU에서 따로 적용하므로 형태를 복사해 씀
const hitGeo = bodyGeo.clone();
const hitRest = Float32Array.from(hitGeo.attributes.position.array);
const hitMesh = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
hitMesh.scale.setScalar(1.05); // 털 끝 근처까지 잡히도록 살짝 크게
body.add(hitMesh);
let hitLie = 0;
function poseHitMesh(lie) {
  if (Math.abs(lie - hitLie) < 0.01 && !(lie === 0 && hitLie !== 0)) return;
  const pos = hitGeo.attributes.position, v = new THREE.Vector3(), out = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromArray(hitRest, i * 3);
    posePos(v, lie, 0, out);
    pos.setXYZ(i, out.x, out.y, out.z);
  }
  pos.needsUpdate = true;
  hitGeo.computeBoundingSphere();
  hitLie = lie;
}

// 바닥 그림자
const shadowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grd.addColorStop(0, 'rgba(70,45,20,0.45)'); grd.addColorStop(1, 'rgba(70,45,20,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
})();
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.4), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = FLOOR_Y - 0.005;
scene.add(shadow);

// ── 기분 · 입력 ────────────────────────────────────
const anim = { blink: 0, nextBlink: 2, close: 0, lie: 0 };
const mood = createMood();

let hover = null, strokeT = 0, squeakedThisGrab = false;
const grabWorld = []; // 잡은 자리마다 처음 잡은 점 (월드 좌표)
createPetting({
  canvas, camera, hitMesh, controls,
  onHover(hit) { hover = hit; fur.setTouch(hit?.local ?? null, hit ? 0.5 : 0); },
  onStroke(s) {
    strokeT = 0.3;
    fur.comb(s.uv, s.dir, Math.min(1, 0.25 + s.dist * 6), s.local);
    mood.stroke(s);
  },
  onGrab(hit) {
    const slot = soft.freeSlot();
    if (slot < 0) return -1;              // 이미 최대 개수만큼 잡고 있음
    sound.unlock();
    if (!soft.held) squeakedThisGrab = false;
    grabWorld[slot] = hit.world.clone();
    soft.grab(slot, body.worldToLocal(hit.world.clone()));
    return slot;
  },
  onDrag(p, slot) {
    const offset = body.worldToLocal(p.clone()).sub(body.worldToLocal(grabWorld[slot].clone()));
    soft.drag(slot, offset);
  },
  onRelease(slot) { soft.release(slot); },
});

// ── UI ─────────────────────────────────────────────
const moodEl = document.getElementById('mood');
document.getElementById('coats').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-coat]'); if (!b) return;
  document.querySelectorAll('#coats button').forEach((x) => x.classList.toggle('on', x === b));
  fur.setCoat(b.dataset.coat);
});
document.getElementById('sound').addEventListener('click', (e) => {
  e.currentTarget.textContent = sound.toggle() ? '🔈' : '🔇';
});

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 세로 화면(휴대폰)에서는 가로 시야가 좁아지므로 세로 시야를 넓혀 햄스터가 잘리지 않게
  const BASE_FOV = 30;
  camera.fov = camera.aspect >= 1 ? BASE_FOV
    : (2 * Math.atan(Math.tan((BASE_FOV / 2) * Math.PI / 180) * 0.8 / camera.aspect) * 180) / Math.PI;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ── 매 프레임 ──────────────────────────────────────
const clock = new THREE.Clock();
let t = 0, moodTextT = 0;
const lerp = (a, b, k) => a + (b - a) * k;
const tmpV = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
const qPose = new THREE.Quaternion(), X_AXIS = new THREE.Vector3(1, 0, 0);
const ease = (x) => x * x * (3 - 2 * x);

// 항상 초당 30프레임만 그려서 GPU 부담(발열)을 줄임
const FPS = 30;
let frameAcc = 0;

renderer.setAnimationLoop(() => {
  frameAcc += clock.getDelta();
  if (frameAcc < 1 / FPS - 0.002) return;
  const dt = Math.min(0.05, frameAcc);
  frameAcc = 0;
  t += dt;
  mood.update(dt);
  fur.update(dt, t);
  const { happy } = mood.state;

  strokeT -= dt;
  mood.state.petting = strokeT > 0;
  mood.state.held = soft.held;
  if (soft.held) mood.state.idle = 0; // 잡고 있는 것도 손길: 엎드려 있으면 일어나지 않음

  // 잡아당기는 중: 많이 늘리면 싫어하고, 처음 크게 늘어날 때 찍
  const stretch = soft.stretch;
  if (soft.held && stretch > 0.18) {
    mood.state.annoyed += dt * 0.8 * stretch;
    if (!squeakedThisGrab && stretch > 0.27) { sound.squeak(); squeakedThisGrab = true; }
  }

  // 엎드리기: 내려갈 땐 비교적 빨리(약 1.5초), 일어날 땐 천천히(약 4초)
  const lieTarget = mood.state.lying ? 1 : 0; // 잡아당겨도 엎드린 자세는 그대로
  anim.lie = THREE.MathUtils.clamp(anim.lie + Math.sign(lieTarget - anim.lie) * dt * (lieTarget ? 0.7 : 0.25), 0, 1);
  const lie = ease(anim.lie);
  soft.uniforms.uLie.value = lie;
  poseHitMesh(lie);

  // 숨쉬기: 배 쪽만 살짝 (편안할수록, 엎드리면 더 느리게)
  const rate = lerp(lerp(4.2, 2.6, happy), 2.0, lie);
  soft.update(dt, Math.sin(t * rate));

  // 몸에 붙은 부품들도 자세·늘어남을 따라감
  for (const obj of partList) {
    const base = obj.userData.base, anchor = obj.userData.anchor ?? base;
    const limb = obj.userData.hand ? 1 : 0;
    posePos(anchor, lie, limb, tmpA);
    qPose.setFromAxisAngle(X_AXIS, limb ? 0 : poseAngle(anchor, lie));
    soft.offsetAt(tmpA, tmpV);
    tmpB.copy(anchor).sub(base).applyQuaternion(qPose); // 기준점이 원점이 아닌 부품(입) 보정
    obj.position.copy(tmpA).add(tmpV).sub(tmpB);
    obj.quaternion.copy(qPose).multiply(obj.userData.baseQuat);
    if (limb) obj.visible = lie < 0.4; // 엎드리면 분홍 손은 몸 밑으로 숨김
  }

  // 고개 돌리기: 커서(없으면 카메라) 쪽을 보되, 쓰다듬거나 잡고 있을 땐 거의 가만히
  const target = hover?.world ?? camera.position;
  const yaw = THREE.MathUtils.clamp(Math.atan2(target.x, target.z), -0.45, 0.45);
  const still = soft.held || anim.lie > 0.05 ? 0 : mood.state.petting ? 0.5 : 2.5;
  body.rotation.y = lerp(body.rotation.y, yaw, dt * still);

  // 눈: 깜빡임, 기분이 좋을수록 실눈, '너무 좋아요…'·엎드림에서는 감음
  anim.nextBlink -= dt;
  if (anim.nextBlink < 0) { anim.blink = 1; anim.nextBlink = 2.5 + Math.random() * 4; }
  anim.blink = Math.max(0, anim.blink - dt * 8);
  // 잡아당겨도 감은 눈은 감은 채로, 뜬 눈은 늘어나는 만큼 살짝 커짐
  anim.close = lerp(anim.close, happy > 0.7 || mood.state.lying ? 1 : 0, Math.min(1, dt * 4));
  const squint = Math.max(happy * 0.6, anim.close, anim.blink);
  const wide = soft.held ? 1 + Math.min(0.15, stretch * 0.5) * (1 - anim.close) : 1;
  parts.eyes.forEach((e) => e.scale.set(EYE_SCALE.x * wide, EYE_SCALE.y * wide * (1 - squint * 0.94), EYE_SCALE.z));

  // 코 실룩 · 수염
  const sniff = Math.max(0, Math.sin(t * 0.9)) ** 4;
  parts.nose.position.y += Math.sin(t * 30) * 0.006 * sniff; // 위에서 매 프레임 원위치로 돌려놓으므로 누적되지 않음
  parts.whiskers.rotation.x = poseAngle(parts.whiskers.userData.base, lie) + Math.sin(t * 30) * 0.03 * sniff;

  // 귀: 편안하면 뒤로 살짝 눕힘
  parts.ears.forEach((e) => { e.rotation.x = lerp(e.rotation.x, -happy * 0.5, dt * 3); });

  moodTextT -= dt;
  if (moodTextT < 0) { moodEl.textContent = mood.text(); moodTextT = 0.2; }

  controls.update();
  renderer.render(scene, camera);
});
