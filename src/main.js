// 장면 구성과 매 프레임 갱신.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildBodyGeometry, buildParts, FLOOR_Y, EYE_SCALE } from './hamster.js';
import { createFur } from './fur.js';
import { createSoftBody, posePos, poseAngle, walkPos, sitDrop, stabilizeHead, legSpreadAngle } from './softbody.js';
import { createPetting } from './petting.js';
import { createMood, TANTRUM_TIME } from './mood.js';
import { createRoamer } from './roam.js';
import { createHang, isScruff } from './hang.js';
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
controls.maxDistance = 22; // 방 전체 시점까지 물러날 수 있게
controls.maxPolarAngle = Math.PI - 0.05; // 바닥 아래로 내려가 밑에서 올려다보기 가능
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }; // 왼쪽은 쓰다듬기용
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }; // 한 손가락: 햄스터 밖이면 돌려보기(petting.js가 조절), 두 손가락: 확대·축소 (이동은 꺼져 있음)

// ── 햄스터 ─────────────────────────────────────────
// body(고개 돌리기) 안에 털 메시들, 몸에 붙는 부위들, 클릭 판정용 메시가 들어간다.
// walker(바닥 위 위치·방향, 걷기) → hanger(목덜미 잡고 들어올리기) → body(고개 돌리기·성질낼 때 들기)
const walker = new THREE.Group();
const hanger = new THREE.Group();
const body = new THREE.Group();
walker.add(hanger);
hanger.add(body);
scene.add(walker);
const hang = createHang(hanger);

const bodyGeo = buildBodyGeometry();
const parts = buildParts();
const soft = createSoftBody();
const fur = createFur(bodyGeo, parts.anchors, soft);
const partList = parts.group.children;
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
walker.add(shadow); // 그림자도 햄스터를 따라 다님

// 바닥 매트: 햄스터가 돌아다니는 방. 가장자리는 배경으로 스며들게
const ROOM_R = 4.5;
const matTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'), grd = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  grd.addColorStop(0, 'rgba(236,217,186,1)'); grd.addColorStop(0.85, 'rgba(232,212,180,0.9)'); grd.addColorStop(1, 'rgba(232,212,180,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();
const floorMat = new THREE.Mesh(new THREE.CircleGeometry(ROOM_R, 96), new THREE.MeshBasicMaterial({ map: matTex, transparent: true, depthWrite: false, toneMapped: false }));
floorMat.rotation.x = -Math.PI / 2;
floorMat.position.y = FLOOR_Y - 0.012;
floorMat.renderOrder = -1;
scene.add(floorMat);

// ── 기분 · 입력 ────────────────────────────────────
const anim = { blink: 0, nextBlink: 2, close: 0, lie: 0 };
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
    if (slot < 0) return -1;              // 이미 최대 개수만큼 잡고 있음
    sound.unlock();
    if (!soft.held) squeakedThisGrab = false;
    grabWorld[slot] = hit.world.clone();
    const local = body.worldToLocal(hit.world.clone());
    soft.grab(slot, local);
    if (isScruff(local) && hang.slot < 0) hang.grab(slot, walker.worldToLocal(hit.world.clone())); // 목덜미: 들어올리기 후보
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
    const offset = body.worldToLocal(p.clone()).sub(body.worldToLocal(grabWorld[slot].clone()));
    soft.drag(slot, offset);
  },
  onRelease(slot) {
    soft.release(slot);
    const moved = hang.release(slot); // 들려 있었으면 옮긴 자리에 떨어짐
    if (moved) {
      walker.position.add(moved.applyQuaternion(walker.quaternion));
      if (walker.position.length() > ROOM_R - 0.4) walker.position.setLength(ROOM_R - 0.4);
    }
  },
});

// ── UI ─────────────────────────────────────────────
const moodEl = document.getElementById('mood');
document.getElementById('coats').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-coat]'); if (!b) return;
  document.querySelectorAll('#coats button').forEach((x) => x.classList.toggle('on', x === b));
  fur.setCoat(b.dataset.coat);
});
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

// ── 매 프레임 ──────────────────────────────────────
const clock = new THREE.Clock();
let t = 0, moodTextT = 0;
const lerp = (a, b, k) => a + (b - a) * k;
const tmpV = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
const tmpW = new THREE.Vector3();
const qPose = new THREE.Quaternion(), qWalk = new THREE.Quaternion(), qStab = new THREE.Quaternion(), qTmp = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0), Z_AXIS = new THREE.Vector3(0, 0, 1);
const ease = (x) => x * x * (3 - 2 * x);

// ── 걷기 ───────────────────────────────────────────
// 대각선 다리(왼앞+오른뒤, 오른앞+왼뒤)가 번갈아 앞뒤로 흔들리고, 앞으로 내딛는 발은 살짝 듦.
const WALK_SPEED = 0.5;   // 걷는 속도 (몸 길이 단위/초)
const STEP_HZ = 2.2;      // 걸음 빠르기 (속도가 최대일 때 1초에 몇 걸음 주기)
const LEG_SWING = 0.38;   // 다리를 앞뒤로 흔드는 최대 각도
const FOOT_LIFT = 0.05;   // 발을 드는 최대 높이
const LEG_PHASE = [0, Math.PI, Math.PI, 0];
const TURN_SPEED = 2.2;   // 방향을 트는 최대 속도 (rad/초)
const walk = { speed: 0, phase: 0 };
const legAngles = [0, 0, 0, 0], legLifts = [0, 0, 0, 0], legSpreads = [0, 0, 0, 0];
// 돌아다니기 (켜기/끄기 버튼). 바닥 위에서 마우스를 움직이면 그쪽으로 따라감
const roamer = createRoamer({ roomRadius: ROOM_R });
let roamOn = true;
const walkBtn = document.getElementById('walk');
walkBtn?.classList.toggle('on', roamOn);
walkBtn?.addEventListener('click', () => { roamOn = !roamOn; walkBtn.classList.toggle('on', roamOn); });
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_Y);
const floorRay = new THREE.Raycaster(), floorNdc = new THREE.Vector2(), floorHit = new THREE.Vector3();
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || hover || e.buttons) return; // 햄스터 위거나 드래그 중이면 무시
  const r = canvas.getBoundingClientRect();
  floorNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  floorRay.setFromCamera(floorNdc, camera);
  if (floorRay.ray.intersectPlane(floorPlane, floorHit)) roamer.seeMouse(floorHit.setY(0));
});

// ── 카메라 시점 ────────────────────────────────────
// follow: 걸어가는 햄스터를 부드럽게 따라감 (따라가는 중에도 돌려보기 가능)
// room:   방 전체를 내려다보는 고정 시점
// 모드를 바꾸면 1초 동안 카메라가 부드럽게 옮겨감
const FOLLOW_OFFSET = new THREE.Vector3(3.0, 1.3, 4.4);
const ROOM_VIEW = { pos: new THREE.Vector3(0, 11, 13.5), target: new THREE.Vector3(0, FLOOR_Y, 0) }; // 매트 전체가 들어오게
const cam = { mode: 'follow', t: 1, fromPos: new THREE.Vector3(), fromTarget: new THREE.Vector3() };
const camBtn = document.getElementById('cam');
function setCamMode(mode) {
  cam.mode = mode; cam.t = 0;
  cam.fromPos.copy(camera.position); cam.fromTarget.copy(controls.target);
  if (camBtn) camBtn.textContent = mode === 'room' ? '방 전체' : '따라가기';
}
camBtn?.addEventListener('click', () => setCamMode(cam.mode === 'follow' ? 'room' : 'follow'));
const camGoalPos = new THREE.Vector3(), camGoalTarget = new THREE.Vector3(), followPrev = new THREE.Vector3();
function updateCamera(dt) {
  if (cam.mode === 'follow') { camGoalTarget.copy(walker.position); camGoalTarget.y += hang.lift.y * 0.6; camGoalPos.copy(camGoalTarget).add(FOLLOW_OFFSET); }
  else { camGoalTarget.copy(ROOM_VIEW.target); camGoalPos.copy(ROOM_VIEW.pos); }
  if (cam.t < 1) {
    // 모드 바꾸는 중: 시작 위치에서 목표 시점으로 부드럽게
    cam.t = Math.min(1, cam.t + dt);
    const k = ease(cam.t);
    camera.position.lerpVectors(cam.fromPos, camGoalPos, k);
    controls.target.lerpVectors(cam.fromTarget, camGoalTarget, k);
  } else if (cam.mode === 'follow') {
    // 따라가기: 사용자가 돌려 둔 각도는 그대로 두고, 햄스터가 움직인 만큼 카메라와 바라보는 점을 함께 옮김
    const move = tmpC.copy(walker.position).sub(followPrev);
    camera.position.add(move); controls.target.add(move);
    controls.target.lerp(camGoalTarget, Math.min(1, dt * 3));
  }
  followPrev.copy(walker.position);
}
const tmpC = new THREE.Vector3();

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
  hang.update(dt);
  mood.state.hanging = hang.active;
  const hangAmt = hang.amount;
  // 들려 있으면 그림자가 작고 흐려짐
  shadow.scale.setScalar(1 / (1 + hang.lift.y * 0.8));
  shadow.position.set(hang.lift.x, FLOOR_Y - 0.005, hang.lift.z);
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

  // 돌아다니기: 만지거나 잡거나 엎드리거나 성질낼 때는 멈춤
  const busy = soft.held || mood.state.petting || !!hover || mood.state.lying || anim.lie > 0.05 || mood.state.tantrum > 0;
  const roam = roamer.update(dt, { pos: walker.position, enabled: roamOn, busy });
  // 바라볼 곳으로 방향을 틀고, 많이 틀어야 할수록 천천히 걸음
  let turnSlow = 1;
  if (roam.faceTo) {
    const want = Math.atan2(roam.faceTo.x - walker.position.x, roam.faceTo.z - walker.position.z);
    let diff = want - walker.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    walker.rotation.y += THREE.MathUtils.clamp(diff, -TURN_SPEED * dt, TURN_SPEED * dt);
    turnSlow = Math.max(0.15, Math.cos(Math.min(Math.abs(diff), Math.PI / 2)));
  }
  // 걸음: 속도에 맞춰 걸음 주기와 다리 흔들림이 커짐 (방향 트는 중엔 제자리걸음에 가깝게)
  walk.speed = lerp(walk.speed, roam.speed, Math.min(1, dt * 3));
  const stride = Math.min(1.5, walk.speed / WALK_SPEED);
  walk.phase += dt * Math.PI * 2 * STEP_HZ * stride;
  for (let i = 0; i < 4; i++) {
    const ph = walk.phase + LEG_PHASE[i];
    legAngles[i] = LEG_SWING * stride * Math.sin(ph);           // +: 발이 뒤로 (땅을 밀어냄)
    legLifts[i] = FOOT_LIFT * stride * Math.max(0, -Math.cos(ph)); // 앞으로 내딛는 동안 발을 듦
    // 매달렸을 때: 다리가 아래로 축 늘어져 살짝 버둥거림 (뒷다리는 더 아래로)
    const dangle = (i < 2 ? 0.15 : 0.95) + 0.12 * Math.sin(t * (4.5 + i * 0.9) + i);
    legAngles[i] += (dangle - legAngles[i]) * hangAmt;
    legLifts[i] *= 1 - hangAmt;
    // 매달렸을 때 앞발은 양옆으로 활짝, 뒷발은 조금 벌림
    legSpreads[i] = hangAmt * ((i < 2 ? 1.0 : 0.35) + 0.08 * Math.sin(t * (3.7 + i) + i * 2));
  }
  soft.uniforms.uLegAngle.value.fromArray(legAngles);
  soft.uniforms.uLegLift.value.fromArray(legLifts);
  soft.uniforms.uLegSpread.value.fromArray(legSpreads);
  soft.uniforms.uStand.value = Math.max(hangAmt, Math.min(1, stride * 1.5)); // 걸으면(또는 들리면) 엉덩이를 들고, 멈추면 바닥에 앉음
  walker.translateZ(walk.speed * turnSlow * dt);
  if (walker.position.length() > ROOM_R - 0.4) walker.position.setLength(ROOM_R - 0.4); // 매트 밖으로 안 나감
  const nod = Math.max(roam.nod * 0.45, hangAmt * 0.75);          // 킁킁거릴 때 고개 숙임, 매달렸을 땐 머리가 푹 처짐
  soft.uniforms.uNod.value = nod;
  // 몸의 통통·뒤뚱 (아래에서 body에 적용). 머리는 이걸 대부분 거꾸로 상쇄해서 거의 고정 (완전히 멈추면 어색해서 조금은 따라감)
  const HEAD_STAB = 0.7;
  const bob = 0.03 * stride * Math.abs(Math.sin(walk.phase));
  const roll = 0.045 * stride * Math.sin(walk.phase);
  soft.uniforms.uHeadStab.value.set(bob * HEAD_STAB, roll * HEAD_STAB);

  // 몸에 붙은 부품들도 걷기·자세·늘어남을 따라감
  for (const obj of partList) {
    const base = obj.userData.base, anchor = obj.userData.anchor ?? base;
    const limb = obj.userData.hand ? 1 : 0, leg = obj.userData.leg;
    const walked = leg === undefined ? tmpW.copy(anchor) : walkPos(anchor, leg, legAngles, legLifts, tmpW, legSpreads);
    if (leg === undefined) walked.y += sitDrop(anchor, soft.uniforms.uStand.value, lie); // 꼬리는 엉덩이를 따라 내려감
    const stabA = leg === undefined ? stabilizeHead(anchor, bob * HEAD_STAB, roll * HEAD_STAB, walked) : 0; // 얼굴 부품도 머리와 같이
    posePos(walked, lie, limb, tmpA, limb ? 0 : nod);
    qPose.setFromAxisAngle(X_AXIS, limb ? 0 : poseAngle(walked, lie, nod));
    if (leg !== undefined) qWalk.setFromAxisAngle(Z_AXIS, legSpreadAngle(leg, legSpreads)).multiply(qTmp.setFromAxisAngle(X_AXIS, legAngles[leg])); else qWalk.identity();
    soft.offsetAt(tmpA, tmpV);
    qStab.setFromAxisAngle(Z_AXIS, stabA).multiply(qPose);
    tmpB.copy(anchor).sub(base).applyQuaternion(qStab); // 기준점이 원점이 아닌 부품(입) 보정
    obj.position.copy(tmpA).add(tmpV).sub(tmpB);
    obj.quaternion.copy(qStab).multiply(qWalk).multiply(obj.userData.baseQuat);
    if (limb) obj.visible = lie < 0.4; // 엎드리면 분홍 손은 몸 밑으로 숨김
  }

  // 성질내기: 입을 빠르게 크게 벌렸다(0.15초) 잠깐 버티고 천천히 닫음. 그동안 고개를 살짝 쳐들고 눈을 찡그림
  const tp = mood.state.tantrum > 0 ? 1 - mood.state.tantrum / TANTRUM_TIME : 1;
  const open = ease(tp < 0.15 ? tp / 0.15 : tp < 0.65 ? 1 : Math.max(0, 1 - (tp - 0.65) / 0.35));
  parts.mouthOpen.visible = open > 0.01;
  parts.mouthOpen.scale.set(0.6 + 0.4 * open, open, 1);
  // 엉덩이 쪽 바닥을 축으로 앞쪽만 들리게 (몸 전체를 가운데 기준으로 돌리면 엉덩이가 바닥에 묻힘)
  const tilt = -0.1 * open, py = FLOOR_Y, pz = -1.0;
  body.rotation.x = tilt;
  body.position.set(0, py - (py * Math.cos(tilt) - pz * Math.sin(tilt)), pz - (py * Math.sin(tilt) + pz * Math.cos(tilt)));
  body.position.y += bob;  // 걸음마다 통통
  body.rotation.z = roll;  // 좌우로 뒤뚱 (머리는 셰이더에서 거꾸로 상쇄해 고정)

  // 고개 돌리기: 커서(없으면 카메라) 쪽을 보되, 쓰다듬거나 잡고 있을 땐 거의 가만히
  const target = walker.worldToLocal((hover?.world ?? camera.position).clone());
  const yaw = THREE.MathUtils.clamp(Math.atan2(target.x, target.z), -0.45, 0.45) * (1 - stride); // 걸을 땐 앞을 봄
  const still = soft.held || anim.lie > 0.05 ? 0 : mood.state.petting ? 0.5 : 2.5;
  body.rotation.y = lerp(body.rotation.y, yaw, dt * still);

  // 눈: 깜빡임, 기분이 좋을수록 실눈, '너무 좋아요…'·엎드림에서는 감음
  anim.nextBlink -= dt;
  if (anim.nextBlink < 0) { anim.blink = 1; anim.nextBlink = 2.5 + Math.random() * 4; }
  anim.blink = Math.max(0, anim.blink - dt * 8);
  // 잡아당겨도 감은 눈은 감은 채로, 뜬 눈은 늘어나는 만큼 살짝 커짐
  anim.close = lerp(anim.close, happy > 0.7 || mood.state.lying ? 1 : 0, Math.min(1, dt * 4));
  const squint = Math.max(happy * 0.6, anim.close, anim.blink, open * 0.75); // 성질낼 땐 찡그림
  const wide = soft.held ? 1 + Math.min(0.15, stretch * 0.5) * (1 - anim.close) : 1;
  parts.eyes.forEach((e) => e.scale.set(EYE_SCALE.x * wide, EYE_SCALE.y * wide * (1 - squint * 0.94), EYE_SCALE.z));

  // 코 실룩 · 수염
  const sniff = Math.max(Math.max(0, Math.sin(t * 0.9)) ** 4, roam.sniff); // 평소엔 가끔, 바닥을 킁킁거릴 땐 계속
  parts.nose.position.y += Math.sin(t * 30) * 0.006 * sniff; // 위에서 매 프레임 원위치로 돌려놓으므로 누적되지 않음
  parts.whiskers.rotation.x = poseAngle(parts.whiskers.userData.base, lie, nod) + Math.sin(t * 30) * 0.03 * sniff;

  // 귀: 편안하면 뒤로 살짝 눕힘
  parts.ears.forEach((e) => { e.rotation.x = lerp(e.rotation.x, -happy * 0.5 - open * 0.6, dt * (open > 0 ? 10 : 3)); }); // 성질낼 땐 귀를 확 젖힘

  moodTextT -= dt;
  if (moodTextT < 0) { moodEl.textContent = mood.text(); moodTextT = 0.2; }

  updateCamera(dt);
  controls.update();
  renderer.render(scene, camera);
});
