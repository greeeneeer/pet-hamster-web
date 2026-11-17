// 장면 구성과 매 프레임 갱신. 각 동작은 모듈에 있고, 여기서는 순서대로 이어 붙인다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildBodyGeometry, buildParts, FLOOR_Y, EYE_SCALE } from './hamster.js';
import { createFur } from './fur.js';
import { createSoftBody, posePos, poseAngle, headWeight, walkPos, sitDrop, stabilizeHead, legSpreadAngle } from './softbody.js';
import { createPetting } from './petting.js';
import { createMood, TANTRUM_TIME } from './mood.js';
import { createRoamer } from './roam.js';
import { createHang, isScruff } from './hang.js';
import { createGait } from './gait.js';
import { createStage, keepInRoom, ROOM_R } from './stage.js';
import { createCameraModes } from './camera.js';
import { sound } from './sound.js';

const FPS = 30;           // 항상 초당 30프레임만 그려서 GPU 부담(발열)을 줄임
const TURN_SPEED = 2.2;   // 방향을 트는 최대 속도 (rad/초)
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (x) => x * x * (3 - 2 * x);

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
controls.maxDistance = 22;                // 방 전체 시점까지 물러날 수 있게
controls.maxPolarAngle = Math.PI - 0.05;  // 바닥 아래로 내려가 밑에서 올려다보기 가능
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }; // 왼쪽은 쓰다듬기용
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }; // 한 손가락: 햄스터 밖이면 돌려보기(petting.js가 조절), 두 손가락: 확대·축소

// ── 햄스터 ─────────────────────────────────────────
// walker(바닥 위 위치·방향) → hanger(목덜미 잡고 들어올리기) → body(고개 돌리기·성질낼 때 들기·걸음 흔들림)
// body 안에 털 메시들, 몸에 붙는 부위들, 클릭 판정용 메시가 들어간다.
const walker = new THREE.Group();
const hanger = new THREE.Group();
const body = new THREE.Group();
walker.add(hanger);
hanger.add(body);
scene.add(walker);

const bodyGeo = buildBodyGeometry();
const parts = buildParts();
const partList = parts.group.children;
const soft = createSoftBody();
const fur = createFur(bodyGeo, parts.anchors, soft);
body.add(
  fur.mesh, parts.group,
  fur.addLimbFur(partList.filter((o) => o.userData.limb)),
  fur.addLimbFur(partList.filter((o) => o.userData.tail), { furScale: 0.6 }), // 꼬리: 더 짧은 흰 털
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
    posePos(v.fromArray(hitRest, i * 3), lie, 0, out);
    pos.setXYZ(i, out.x, out.y, out.z);
  }
  pos.needsUpdate = true;
  hitGeo.computeBoundingSphere();
  hitLie = lie;
}
// 잡은 삼각형의 '서 있을 때' 위치 (몸 기준). 엎드려 납작해져도 어느 부위인지 똑같이 판정하려고
const restPoint = (face) => {
  const p = new THREE.Vector3(), v = new THREE.Vector3();
  for (const i of [face.a, face.b, face.c]) p.add(v.fromArray(hitRest, i * 3));
  return p.multiplyScalar(hitMesh.scale.x / 3);
};

const stage = createStage(scene, walker);
const hang = createHang(hanger);
const gait = createGait();
const roamer = createRoamer({ roomRadius: ROOM_R });
const camModes = createCameraModes({ camera, controls, walker, button: document.getElementById('cam') });

// ── 기분 · 입력 ────────────────────────────────────
const anim = { blink: 0, nextBlink: 2, close: 0, lie: 0, doze: 0, nextDoze: 8, walkSniff: 0 };
const mood = createMood({ onTantrum: () => sound.hiss() });

let hover = null, strokeT = 0, squeakedThisGrab = false;
const grabWorld = []; // 잡은 자리마다 처음 잡은 점 (월드 좌표)
const tmpQ = new THREE.Quaternion(), tmpUp = new THREE.Vector3();
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
    if (slot < 0) return -1; // 이미 최대 개수만큼 잡고 있음
    sound.unlock();
    if (!soft.held) squeakedThisGrab = false;
    grabWorld[slot] = hit.world.clone();
    const local = body.worldToLocal(hit.world.clone());
    soft.grab(slot, local);
    if (isScruff(restPoint(hit.face)) && hang.slot < 0) hang.grab(slot, walker.worldToLocal(hit.world.clone())); // 목덜미: 들어올리기 후보
    return slot;
  },
  onDrag(p, slot) {
    if (slot === hang.slot) hang.drag(slot, walker.worldToLocal(p.clone()));
    if (slot === hang.slot && hang.active) {
      // 매달린 동안: 목덜미 살만 위로 살짝 당겨짐 (몸 전체는 hanger가 들어올림)
      body.getWorldQuaternion(tmpQ).invert();
      soft.drag(slot, tmpUp.set(0, 0.22, 0).applyQuaternion(tmpQ));
      return;
    }
    soft.drag(slot, body.worldToLocal(p.clone()).sub(body.worldToLocal(grabWorld[slot].clone())));
  },
  onRelease(slot) {
    soft.release(slot);
    const moved = hang.release(slot); // 들려 있었으면 옮긴 자리에 떨어지고, 기분은 처음으로
    if (moved) {
      keepInRoom(walker.position.add(moved.applyQuaternion(walker.quaternion)));
      mood.reset();
    }
  },
});

// 바닥 위에서 마우스를 움직이면 그쪽으로 따라감 (햄스터 위거나 드래그 중이면 무시)
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_Y);
const floorRay = new THREE.Raycaster(), floorNdc = new THREE.Vector2(), floorHit = new THREE.Vector3();
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || hover || e.buttons) return;
  const r = canvas.getBoundingClientRect();
  floorNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  floorRay.setFromCamera(floorNdc, camera);
  if (floorRay.ray.intersectPlane(floorPlane, floorHit)) roamer.seeMouse(floorHit.setY(0));
});

// ── UI ─────────────────────────────────────────────
const moodEl = document.getElementById('mood');
document.getElementById('coats').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-coat]'); if (!b) return;
  document.querySelectorAll('#coats button').forEach((x) => x.classList.toggle('on', x === b));
  fur.setCoat(b.dataset.coat);
});
let roamOn = true;
const walkBtn = document.getElementById('walk');
walkBtn?.classList.toggle('on', roamOn);
walkBtn?.addEventListener('click', () => { roamOn = !roamOn; walkBtn.classList.toggle('on', roamOn); });
// 브라우저는 사용자가 한 번 누른 뒤에야 소리를 허락하므로, 아무 데나 누르면 소리를 켤 준비를 함
addEventListener('pointerdown', () => sound.unlock());
document.getElementById('sound').addEventListener('click', (e) => {
  e.currentTarget.textContent = sound.toggle() ? '🔈' : '🔇';
});

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 세로 화면(휴대폰)에서는 가로 시야가 좁아지므로 세로 시야를 넓혀 햄스터가 잘리지 않게
  const BASE_FOV = 30;
  camera.fov = Math.max(BASE_FOV, (2 * Math.atan(Math.tan((BASE_FOV / 2) * Math.PI / 180) * 0.8 / camera.aspect) * 180) / Math.PI);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ── 몸에 붙은 부위들이 걷기·자세·늘어남을 따라가게 ──────
const tmpV = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpW = new THREE.Vector3();
const qPose = new THREE.Quaternion(), qWalk = new THREE.Quaternion(), qStab = new THREE.Quaternion(), qTmp = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0), Y_AXIS = new THREE.Vector3(0, 1, 0), Z_AXIS = new THREE.Vector3(0, 0, 1);

function updateParts(lie, nod, yaw) {
  const stand = soft.uniforms.uStand.value;
  for (const obj of partList) {
    const base = obj.userData.base, anchor = obj.userData.anchor ?? base;
    const limb = obj.userData.hand ? 1 : 0, leg = obj.userData.leg;
    let walked, stabA = 0;
    if (leg === undefined) {
      walked = tmpW.copy(anchor);
      walked.y += sitDrop(anchor, stand, lie);                              // 꼬리는 엉덩이를 따라 내려감
      stabA = stabilizeHead(anchor, gait.headBob, gait.headRoll, walked); // 얼굴 부품은 머리와 같이 거의 고정
      qWalk.identity();
    } else {
      walked = walkPos(anchor, leg, gait.angles, gait.lifts, tmpW, gait.spreads);
      qWalk.setFromAxisAngle(Z_AXIS, legSpreadAngle(leg, gait.spreads)).multiply(qTmp.setFromAxisAngle(X_AXIS, gait.angles[leg]));
    }
    posePos(walked, lie, limb, tmpA, limb ? 0 : nod, limb ? 0 : yaw);
    qPose.setFromAxisAngle(Y_AXIS, limb ? 0 : yaw * headWeight(walked)).multiply(qTmp.setFromAxisAngle(X_AXIS, limb ? 0 : poseAngle(walked, lie, nod)));
    qStab.setFromAxisAngle(Z_AXIS, stabA).multiply(qPose);
    soft.offsetAt(tmpA, tmpV);
    tmpB.copy(anchor).sub(base).applyQuaternion(qStab); // 기준점이 원점이 아닌 부품(입) 보정
    obj.position.copy(tmpA).add(tmpV).sub(tmpB);
    obj.quaternion.copy(qStab).multiply(qWalk).multiply(obj.userData.baseQuat);
    if (limb) obj.visible = lie < 0.4; // 엎드리면 분홍 손은 몸 밑으로 숨김
  }
}

// ── 매 프레임 ──────────────────────────────────────
const clock = new THREE.Clock();
let t = 0, moodTextT = 0, frameAcc = 0;

renderer.setAnimationLoop(() => {
  frameAcc += clock.getDelta();
  if (frameAcc < 1 / FPS - 0.002) return;
  const dt = Math.min(0.05, frameAcc);
  frameAcc = 0;
  t += dt;

  // 기분
  mood.update(dt);
  fur.update(dt, t);
  const { happy } = mood.state;
  strokeT -= dt;
  mood.state.petting = strokeT > 0;
  mood.state.held = soft.held;
  if (soft.held) mood.state.idle = 0; // 잡고 있는 것도 손길: 엎드려 있으면 일어나지 않음

  // 매달리기
  hang.update(dt);
  mood.state.hanging = hang.active;
  stage.update(hang.lift);

  // 잡아당기는 중: 많이 늘리면 싫어하고, 처음 크게 늘어날 때 찍
  const stretch = soft.stretch;
  if (soft.held && stretch > 0.18) {
    mood.state.annoyed += dt * 0.8 * stretch;
    if (!squeakedThisGrab && stretch > 0.27) { sound.squeak(); squeakedThisGrab = true; }
  }

  // 엎드리기: 내려갈 땐 비교적 빨리(약 1.5초), 일어날 땐 천천히(약 4초). 잡아당겨도 그대로.
  // 녹아내린 채 들어올리면 몸은 금방 펴짐 (내려놓으면 기분이 처음으로 돌아가 그대로 서 있음)
  const lieTarget = mood.state.lying && !hang.active ? 1 : 0;
  const lieRate = lieTarget ? 0.7 : hang.active ? 1.5 : 0.25;
  anim.lie = THREE.MathUtils.clamp(anim.lie + Math.sign(lieTarget - anim.lie) * dt * lieRate, 0, 1);
  const lie = ease(anim.lie);
  soft.uniforms.uLie.value = lie;
  poseHitMesh(lie);

  // 숨쉬기: 배 쪽만 살짝 (편안할수록, 엎드리면 더 느리게)
  soft.update(dt, Math.sin(t * lerp(lerp(4.2, 2.6, happy), 2.0, lie)));

  // 돌아다니기: 만지거나 잡거나 엎드리거나 성질낼 때는 멈춤
  const busy = soft.held || mood.state.petting || !!hover || mood.state.lying || anim.lie > 0.05 || mood.state.tantrum > 0;
  const roam = roamer.update(dt, { pos: walker.position, enabled: roamOn, busy });
  let turnSlow = 1; // 많이 틀어야 할수록 천천히 걸음
  if (roam.faceTo) {
    const want = Math.atan2(roam.faceTo.x - walker.position.x, roam.faceTo.z - walker.position.z);
    const diff = Math.atan2(Math.sin(want - walker.rotation.y), Math.cos(want - walker.rotation.y));
    walker.rotation.y += THREE.MathUtils.clamp(diff, -TURN_SPEED * dt, TURN_SPEED * dt);
    turnSlow = Math.max(0.15, Math.cos(Math.min(Math.abs(diff), Math.PI / 2)));
  }

  // 걸음·다리
  gait.update(dt, t, roam.speed, hang.amount);
  const u = soft.uniforms;
  u.uLegAngle.value.fromArray(gait.angles);
  u.uLegLift.value.fromArray(gait.lifts);
  u.uLegSpread.value.fromArray(gait.spreads);
  u.uStand.value = Math.max(hang.amount, Math.min(1, gait.stride * 1.5)); // 걷거나 들리면 엉덩이를 들고, 멈추면 바닥에 앉음
  u.uHeadStab.value.set(gait.headBob, gait.headRoll);
  walker.translateZ(gait.speed * turnSlow * dt);
  keepInRoom(walker.position);
  // 걸으면서 킁킁: 고개를 살짝 숙이고 좌우로 이리저리 돌리며 냄새를 맡음 (불규칙하게 보이도록 두 흔들림을 섞음)
  anim.walkSniff = lerp(anim.walkSniff, Math.min(1, gait.stride) * (1 - hang.amount), Math.min(1, dt * 3));
  const headYaw = anim.walkSniff * (0.3 * Math.sin(t * 1.6) + 0.12 * Math.sin(t * 3.7 + 1.3));
  const nod = Math.max(roam.nod * 0.45, anim.walkSniff * 0.12, hang.amount * 0.75); // 킁킁거릴 때 고개 숙임, 매달렸을 땐 머리가 푹 처짐
  u.uNod.value = nod;
  u.uHeadYaw.value = headYaw;
  updateParts(lie, nod, headYaw);

  // 성질내기: 입을 빠르게 크게 벌렸다(0.15초) 잠깐 버티고 천천히 닫음. 그동안 고개를 살짝 쳐들고 눈을 찡그림
  const tp = mood.state.tantrum > 0 ? 1 - mood.state.tantrum / TANTRUM_TIME : 1;
  const open = ease(tp < 0.15 ? tp / 0.15 : tp < 0.65 ? 1 : Math.max(0, 1 - (tp - 0.65) / 0.35));
  parts.mouthOpen.visible = open > 0.01;
  parts.mouthOpen.scale.set(0.6 + 0.4 * open, open, 1);
  // 엉덩이 쪽 바닥을 축으로 앞쪽만 들리게 (몸 전체를 가운데 기준으로 돌리면 엉덩이가 바닥에 묻힘)
  const tilt = -0.1 * open, py = FLOOR_Y, pz = -1.0;
  body.rotation.x = tilt;
  body.position.set(0, py - (py * Math.cos(tilt) - pz * Math.sin(tilt)) + gait.bob, pz - (py * Math.sin(tilt) + pz * Math.cos(tilt)));
  body.rotation.z = gait.roll; // 좌우로 뒤뚱 (머리는 셰이더에서 대부분 상쇄)

  // 고개 돌리기: 커서(없으면 카메라) 쪽을 보되, 걸을 땐 앞을 보고, 쓰다듬거나 잡고 있을 땐 거의 가만히
  const look = walker.worldToLocal((hover?.world ?? camera.position).clone());
  const yaw = THREE.MathUtils.clamp(Math.atan2(look.x, look.z), -0.45, 0.45) * (1 - Math.min(1, gait.stride));
  const still = soft.held || anim.lie > 0.05 ? 0 : mood.state.petting ? 0.5 : 2.5;
  body.rotation.y = lerp(body.rotation.y, yaw, dt * still);

  // 눈: 깜빡임, 기분이 좋을수록 실눈, '너무 좋아요…'·엎드림에서는 감음, 성질낼 땐 찡그림.
  // 잡아당겨도 감은 눈은 감은 채로, 뜬 눈은 늘어나는 만큼 살짝 커짐
  anim.nextBlink -= dt;
  if (anim.nextBlink < 0) { anim.blink = 1; anim.nextBlink = 2.5 + Math.random() * 4; }
  anim.blink = Math.max(0, anim.blink - dt * 8);
  // 이따금 졸듯이 눈을 지그시 감음 (앉아 있을 때만. 걷거나 잡혀 있거나 성질낼 땐 깸)
  const awake = gait.stride > 0.1 || soft.held || hang.active || mood.state.tantrum > 0;
  anim.nextDoze -= dt;
  if (anim.nextDoze < 0) { if (!awake) anim.doze = 1.2 + Math.random() * 1.8; anim.nextDoze = 7 + Math.random() * 10; }
  anim.doze = awake ? 0 : Math.max(0, anim.doze - dt);
  anim.close = lerp(anim.close, happy > 0.7 || mood.state.lying || anim.doze > 0 ? 1 : 0, Math.min(1, dt * 4));
  const squint = Math.max(happy * 0.6, anim.close, anim.blink, open * 0.75);
  const wide = soft.held ? 1 + Math.min(0.15, stretch * 0.5) * (1 - anim.close) : 1;
  parts.eyes.forEach((e) => e.scale.set(EYE_SCALE.x * wide, EYE_SCALE.y * wide * (1 - squint * 0.94), EYE_SCALE.z));

  // 코 실룩 · 수염: 평소엔 가끔, 바닥을 킁킁거리거나 걸을 땐 계속
  const sniff = Math.max(Math.max(0, Math.sin(t * 0.9)) ** 4, roam.sniff, anim.walkSniff * 0.8);
  parts.nose.position.y += Math.sin(t * 30) * 0.006 * sniff; // updateParts가 매 프레임 원위치로 돌려놓으므로 누적되지 않음
  parts.whiskers.quaternion.multiply(qTmp.setFromAxisAngle(X_AXIS, Math.sin(t * 30) * 0.03 * sniff)); // updateParts가 매 프레임 새로 정함

  // 귀: 편안하면 뒤로 살짝 눕히고, 성질낼 땐 확 젖힘
  parts.ears.forEach((e) => { e.rotation.x = lerp(e.rotation.x, -happy * 0.5 - open * 0.6, dt * (open > 0 ? 10 : 3)); });

  moodTextT -= dt;
  if (moodTextT < 0) { moodEl.textContent = mood.text(); moodTextT = 0.2; }

  camModes.update(dt, hang.lift.y);
  controls.update();
  renderer.render(scene, camera);
});
