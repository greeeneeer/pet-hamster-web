// 햄스터 몸 모양과 얼굴 부품(눈·귀·코·입·수염·다리). +z 방향이 얼굴이다.
//
// 몸은 덩어리 여러 개(몸통, 높이 든 머리, 주둥이, 볼)를 부드럽게 이어 붙인 모양이다.
// 덩어리 사이가 매끄럽게 메워지면서 조랭이떡처럼 완만하게 잘록한 목이 생긴다.
// (각 덩어리를 거리 함수로 두고 smooth-min으로 합친 뒤, 구의 꼭짓점을 그 표면으로 옮긴다)
import * as THREE from 'three';

const V3 = THREE.Vector3;

export const FLOOR_Y = -0.57;
const BOTTOM_Y = -0.52;            // 몸통 바닥(납작한 면)
export const EYE_SCALE = new V3(0.92, 1.02, 1);

// 덩어리: 중심 c, 반지름 r (x 너비, y 높이, z 길이)
export const SHAPE = {
  body:  { c: new V3(0, 0.0, -0.34),  r: new V3(0.7, 0.64, 0.8) },   // 엉덩이까지 둥근 몸통
  head:  { c: new V3(0, 0.42, 0.56),  r: new V3(0.5, 0.47, 0.5) },   // 높이 든 머리
  chest: { c: new V3(0, -0.12, 0.26), r: new V3(0.36, 0.28, 0.32) },  // 머리 아래 가슴 (작게)
  bridge:{ c: new V3(0, 0.43, 0.8),   r: new V3(0.31, 0.3, 0.36) },   // 이마에서 코로 볼록하게 이어지는 콧등
  snout: { c: new V3(0, 0.31, 1.06),  r: new V3(0.21, 0.2, 0.25) },   // 앞·위로 살짝 나온 주둥이
};
const BLEND = { neck: 0.34, bridge: 0.2, snout: 0.25, chest: 0.24, bottom: 0.06 };

function ell(px, py, pz, { c, r }) {
  const x = (px - c.x) / r.x, y = (py - c.y) / r.y, z = (pz - c.z) / r.z;
  return (Math.sqrt(x * x + y * y + z * z) - 1) * Math.min(r.x, r.y, r.z);
}
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }

// 표면까지의 (대략적) 거리: 안쪽이 음수
export function sdf(x, y, z) {
  let d = smin(ell(x, y, z, SHAPE.body), ell(x, y, z, SHAPE.head), BLEND.neck);
  d = smin(d, ell(x, y, z, SHAPE.chest), BLEND.chest);
  d = smin(d, ell(x, y, z, SHAPE.bridge), BLEND.bridge);
  d = smin(d, ell(x, y, z, SHAPE.snout), BLEND.snout);
  return -smin(-d, -(BOTTOM_Y - y), BLEND.bottom); // 바닥은 납작하게 잘라냄
}

export function normalAt(p) {
  const e = 1e-3;
  return new V3(
    sdf(p.x + e, p.y, p.z) - sdf(p.x - e, p.y, p.z),
    sdf(p.x, p.y + e, p.z) - sdf(p.x, p.y - e, p.z),
    sdf(p.x, p.y, p.z + e) - sdf(p.x, p.y, p.z - e),
  ).normalize();
}

// origin에서 dir 방향으로 나가다가 처음 표면을 벗어나는 점
export function castOut(origin, dir) {
  const step = 0.02;
  let t = 0;
  const at = (s) => sdf(origin.x + dir.x * s, origin.y + dir.y * s, origin.z + dir.z * s);
  while (t < 4 && at(t) < 0) t += step;
  let lo = Math.max(0, t - step), hi = t;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (at(m) < 0) lo = m; else hi = m; }
  return origin.clone().addScaledVector(dir, (lo + hi) / 2);
}

const CENTER = new V3(0, 0.15, 0.1); // 몸 전체를 펼칠 기준점 (머리·몸통 모두 이 점에서 보임)

// 특정 덩어리 중심에서 방향을 정해 표면 위의 점과 법선을 얻음 (얼굴 부품 배치용)
function surfFrom(part, x, y, z) {
  const p = castOut(SHAPE[part].c, new V3(x, y, z).normalize());
  return { p, n: normalAt(p) };
}

// 방향 공간에서 그린 곡선을 표면 위로 옮김 (표면에서 lift만큼 띄움)
function surfaceCurve(part, dirs, lift, segments = 16) {
  const dc = new THREE.CatmullRomCurve3(dirs.map((d) => new V3(...d)));
  return new THREE.CatmullRomCurve3(dc.getPoints(segments).map((d) => {
    const { p, n } = surfFrom(part, d.x, d.y, d.z);
    return p.addScaledVector(n, lift);
  }));
}

// 코: 아랫부분을 아래로 당겨 끝이 모이는 둥근 역삼각형
function noseGeometry() {
  const g = new THREE.SphereGeometry(0.05, 32, 20);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i);
    if (y < 0) { const t = -y / 0.05; y *= 1.55; x *= 1 - 0.45 * t; }
    pos.setXY(i, x, y);
  }
  g.computeVertexNormals();
  return g;
}

// 입: 코에서 내려오는 짧은 선이 아래에서 양쪽으로 갈라지는 ㅅ자 모양
function buildMouth() {
  const mouth = new THREE.Group();
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x4a2e2a, roughness: 0.7 });
  const tube = (curve) => new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.006, 6), lineMat);

  mouth.add(tube(surfaceCurve('snout', [[0, -0.14, 1], [0, -0.55, 1]], 0.034)));     // 인중 (코 아래 끝에서 시작)
  for (const s of [1, -1]) {
    mouth.add(tube(surfaceCurve('snout', [[0, -0.55, 1], [0.1 * s, -0.66, 1], [0.22 * s, -0.78, 0.98], [0.3 * s, -0.86, 0.95]], 0.034))); // 끝이 아래로: 웃지 않는 ㅅ자
  }
  return mouth;
}

// 귀: 오페라하우스 지붕처럼 오목한 껍질. 오목한 면(+z)이 앞, 볼록한 면이 뒤.
function earGeometry() {
  const W = 0.21, H = 0.31, D = 0.1, NU = 18, NV = 18;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= NV; j++) {
    const v = j / NV;
    const w = W * Math.sqrt(Math.max(0, 1 - ((v - 0.42) / 0.58) ** 2)); // 아래는 넓고 위는 둥글게 모이는 윤곽
    for (let i = 0; i <= NU; i++) {
      const u = (i / NU) * 2 - 1;
      const z = -D * (1 - u * u) * Math.sin(Math.PI * Math.min(1, 0.15 + v)) - 0.05 * v * v; // 가운데가 오목, 위쪽은 뒤로 휨
      pos.push(u * w, v * H, z);
      uv.push(i / NU, v);
    }
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 두 점 사이를 잇는 캡슐 (다리용)
// 위(a)는 굵고 아래(b)로 갈수록 가늘어지는 다리. 끝은 둥글게 막음.
function limb(a, b, rTop, rBottom, material) {
  const len = a.distanceTo(b);
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, len, 20, 1, true), material);
  const top = new THREE.Mesh(new THREE.SphereGeometry(rTop, 20, 12), material);
  const bottom = new THREE.Mesh(new THREE.SphereGeometry(rBottom, 20, 12), material);
  top.position.y = len / 2; bottom.position.y = -len / 2;
  g.add(shaft, top, bottom);
  g.position.copy(a).add(b).multiplyScalar(0.5);
  g.quaternion.setFromUnitVectors(new V3(0, 1, 0), a.clone().sub(b).normalize());
  g.userData.limb = true; // 털을 따로 입힘 (fur.addLimbFur)
  return g;
}

// 발: 작은 손바닥(발바닥)에서 가느다란 손가락(발가락)이 앞으로 뻗음. +z가 앞, 원점이 손목(발목).
function paw({ palm, fingers, fingerLen, fingerR, spread, curl }, material) {
  const g = new THREE.Group();
  const sole = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), material);
  sole.scale.copy(palm);
  sole.position.z = palm.z * 0.7;
  g.add(sole);
  const fGeo = new THREE.CapsuleGeometry(fingerR, fingerLen, 4, 8);
  for (let k = 0; k < fingers; k++) {
    const a = (k / (fingers - 1) - 0.5) * spread;              // 부채꼴로 살짝 벌어짐
    const f = new THREE.Group();
    f.position.set(Math.sin(a) * palm.x * 0.8, 0, palm.z * 1.3);
    f.rotation.set(curl, a, 0);                                // 끝이 아래로 살짝 굽음
    const m = new THREE.Mesh(fGeo, material);
    m.rotation.x = Math.PI / 2;
    m.position.z = fingerLen / 2;
    f.add(m);
    g.add(f);
  }
  return g;
}

export function buildBodyGeometry() {
  const geo = new THREE.SphereGeometry(1, 160, 120);
  geo.rotateX(Math.PI / 2); // 구의 극을 코와 엉덩이 쪽으로 (등에 UV 찌그러짐이 없도록)
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const d = new V3();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    const p = castOut(CENTER, d), n = normalAt(p);
    pos.setXYZ(i, p.x, p.y, p.z);
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  geo.computeBoundingSphere();
  return geo;
}

// 얼굴 부품. 털 셰이더가 눈·코 주변 털을 짧게 하려고 위치(anchors)를 쓴다.
export function buildFace() {
  const parts = new THREE.Group();
  const anchors = {};

  // 눈
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.05, clearcoat: 1 });
  const eyeGeo = new THREE.SphereGeometry(0.058, 32, 16);
  const eyes = [];
  for (const s of [1, -1]) {
    const { p, n } = surfFrom('head', 0.44 * s, 0.3, 0.85);
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.copy(p).addScaledVector(n, 0.004); // 얼굴 속에 조금 묻히게
    eye.lookAt(eye.position.clone().add(n));
    eye.scale.copy(EYE_SCALE); // 세로로 긴 눈
    parts.add(eye); eyes.push(eye);
    anchors[s > 0 ? 'eyeL' : 'eyeR'] = p.clone();
  }

  // 귀: 오목한 안쪽이 양옆 바깥(살짝 앞)을 향하게 세움
  const earGeo = earGeometry();
  const earInMat = new THREE.MeshStandardMaterial({ color: 0x9c7b72, roughness: 0.6, side: THREE.FrontSide });
  const earOutMat = new THREE.MeshStandardMaterial({ color: 0x5e4a43, roughness: 0.7, side: THREE.BackSide });
  const ears = []; // 애니메이션용 회전축(pivot)
  for (const s of [1, -1]) {
    const { p } = surfFrom('head', 0.66 * s, 0.72, -0.16);
    const ear = new THREE.Group();
    ear.position.copy(p);
    const zAxis = new V3(0.92 * s, 0.1, 0.3).normalize();    // 오목한 면이 향하는 쪽
    const xAxis = new V3().crossVectors(new V3(0, 1, 0), zAxis).normalize();
    const yAxis = new V3().crossVectors(zAxis, xAxis);
    ear.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    ear.rotateX(0.45);                                          // 위쪽이 바깥으로 눕고 오목한 면이 살짝 아래를 보게
    const pivot = new THREE.Group();
    const inner = new THREE.Mesh(earGeo, earInMat);
    const outer = new THREE.Mesh(earGeo, earOutMat);
    inner.position.y = outer.position.y = -0.015;               // 밑동은 몸에 묻히게
    pivot.add(inner, outer);
    ear.add(pivot);
    parts.add(ear); ears.push(pivot);
  }

  // 코
  const { p: np, n: nn } = surfFrom('snout', 0, 0.14, 1);
  anchors.nose = np.clone();
  const nose = new THREE.Mesh(
    noseGeometry(),
    new THREE.MeshStandardMaterial({ color: 0xe0707f, roughness: 0.35 }),
  );
  nose.scale.set(1, 0.75, 0.7);
  nose.position.copy(np).addScaledVector(nn, 0.01);
  parts.add(nose);

  // 수염
  const whiskers = new THREE.Group();
  whiskers.position.copy(nose.position);
  const wMat = new THREE.LineBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.55 });
  for (const s of [1, -1]) {
    for (let k = 0; k < 4; k++) {
      const L = 0.45 + 0.05 * k;
      const dir = new V3(s, (k - 1.5) * 0.18, -0.25 + k * 0.05).normalize();
      const o = new V3(0.07 * s, -0.02, -0.05);
      const droop = new V3(0, -0.04, 0);
      const curve = new THREE.QuadraticBezierCurve3(
        o, o.clone().addScaledVector(dir, L * 0.5).add(droop), o.clone().addScaledVector(dir, L).addScaledVector(droop, 3),
      );
      whiskers.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(12)), wMat));
    }
  }
  parts.add(whiskers);

  const mouth = buildMouth();
  parts.add(mouth);
  anchors.mouth = surfFrom('snout', 0, -0.55, 1).p;
  mouth.userData.anchor = anchors.mouth; // 자식들이 몸 좌표로 놓여 있으므로 변형은 이 점 기준

  // 다리: 사진처럼 들린 머리·가슴 아래로 앞다리가 비스듬히 내려와 분홍 손으로 바닥을 짚음.
  // 뒷다리는 엉덩이에 묻혀 있고 긴 분홍 뒷발만 살짝 보임.
  const limbMat = new THREE.MeshStandardMaterial({ color: 0xf3e6d3, roughness: 0.9 }); // 배 색을 따라감
  const pawMat = new THREE.MeshStandardMaterial({ color: 0xe8868a, roughness: 0.55 });
  for (const s of [1, -1]) {
    const wrist = new V3(0.14 * s, FLOOR_Y + 0.05, 0.6);
    parts.add(limb(new V3(0.24 * s, -0.22, 0.38), wrist, 0.14, 0.062, limbMat)); // 몸 옆에서 굵게 내려옴
    const hand = paw({ palm: new V3(0.037, 0.017, 0.038), fingers: 4, fingerLen: 0.042, fingerR: 0.009, spread: 0.9, curl: 0.45 }, pawMat);
    hand.position.set(wrist.x, FLOOR_Y + 0.014, wrist.z);
    hand.rotation.y = -0.12 * s;
    hand.userData.hand = true; // 엎드릴 때 앞다리와 같이 모이고 앞으로 나감
    parts.add(hand);

    const hind = paw({ palm: new V3(0.034, 0.016, 0.07), fingers: 5, fingerLen: 0.03, fingerR: 0.0065, spread: 1.0, curl: 0.35 }, pawMat);
    hind.position.set(0.34 * s, FLOOR_Y + 0.016, -0.62);
    hind.rotation.y = 0.12 * s;
    parts.add(hind);
  }

  // 꼬리: 엉덩이 뒤쪽 아래에서 살짝 나온 아주 짧고 뭉툭한 꼬리
  {
    const { p, n } = surfFrom('body', 0, -0.32, -1);
    const dir = n.clone().add(new V3(0, -0.35, 0)).normalize();   // 살짝 아래로 처짐
    const tail = new THREE.Group();
    tail.position.copy(p);
    tail.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir);
    // 짧은 원기둥 + 납작하게 누른 반구 끝 = 뭉툭한 꼬리. 짧은 흰 털을 입힘 (fur.addLimbFur)
    const tailMat = new THREE.MeshStandardMaterial({ color: 0xf3e6d3, roughness: 0.9 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 0.08, 16, 1, true), tailMat);
    shaft.position.y = 0.04;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.036, 16, 10), tailMat);
    tip.scale.set(1, 0.5, 1);                                      // 끝을 납작하게 눌러 뭉툭하게
    tip.position.y = 0.08;
    tail.add(shaft, tip);
    tail.userData.tail = true;
    parts.add(tail);
  }

  // 몸이 늘어나거나 숨쉴 때 함께 움직일 부품들의 원래 위치 기록
  for (const obj of parts.children) {
    obj.userData.base = obj.position.clone();
    obj.userData.baseQuat = obj.quaternion.clone();
  }

  return { parts, eyes, ears, nose, whiskers, mouth, anchors, limbMat };
}
