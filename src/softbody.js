// 몸이 말랑하게 변하는 부분: 배 쪽 숨쉬기, 잡아당기기(손가락마다 최대 GRABS곳)와 놓았을 때 부드럽게 돌아오기, 엎드린 자세,
// 걷기(다리마다 회전축을 중심으로 앞뒤로 흔들고 발을 듦).
// 같은 계산을 셰이더(몸·털)와 JS(눈·귀 같은 부품 위치)에서 똑같이 쓴다.
import * as THREE from 'three';
import { FLOOR_Y, LEG_PIVOTS, RUMP_CENTERS } from './hamster.js';

const GRAB_R = 0.42;   // 잡은 곳 주변으로 늘어나는 범위
const MAX_PULL = 0.32; // 이 이상은 잘 안 늘어남
export const GRABS = 3; // 동시에 잡을 수 있는 곳 (휴대폰에서 손가락 여러 개)
const BREATH_AMP = 0.022;

// 엎드린 자세 (uLie: 0 = 서 있음, 1 = 바닥에 납작 엎드림)
//  - 머리: 목 근처를 축으로 고개를 숙이고 아래로 내림
//  - 앞다리(LIMB): 가운데로 모으며 몸 밑으로 집어넣음
//  - 뒷발: 뒤로 뻗음
//  - 전체: 바닥 쪽으로 납작하게 눌리며 옆으로 퍼짐
const PIVOT = new THREE.Vector3(0, 0.1, 0.25);
const HEAD_ANGLE = 0.5, HEAD_DROP = 0.12, FLATTEN = 0.38, SPREAD = 0.16;
const LIMB_PINCH = 0.45, LIMB_TUCK = 0.12, HIND_STRETCH = 0.22; // 앞다리 모으기·집어넣기, 뒷발 뻗기
const BODY_FOLLOW = 0.75, BODY_FOLLOW_R2 = 0.11; // 걸을 때 다리 주변 몸통 살이 따라가는 정도와 범위
const RUMP_LIFT = 1.5, RUMP_R2 = 0.16;              // 뒷발을 들 때 같은 쪽 엉덩이 덩어리가 들리는 배율과 범위
const SIT_DROP = 0.1;                               // 앉을 때 엉덩이 아래쪽이 내려가는 양
const NOD_DROP = 0.2;                               // 고개를 숙인 각도(rad)당 머리가 내려가는 양
const f3 = (x) => x.toFixed(3);

export const GLSL = /* glsl */ `
uniform float uBreath;
uniform vec3 uGrab[${GRABS}];
uniform vec3 uPull[${GRABS}];
uniform float uLie;
uniform vec4 uLegAngle;  // 다리마다 앞뒤로 흔드는 각도 (x축 회전)
uniform vec4 uLegLift;   // 다리마다 발을 드는 높이
uniform vec4 uLegSpread; // 다리마다 양옆(바깥쪽)으로 벌리는 각도 (z축 회전, 매달렸을 때)
uniform float uStand;    // 0: 엉덩이를 바닥에 대고 앉음(뒷다리 숨김), 1: 걸을 때 엉덩이를 들고 섬
uniform float uNod;      // 고개를 바닥 쪽으로 숙이는 각도 (킁킁거릴 때)
uniform vec2 uHeadStab;  // 걸을 때 몸의 통통(x)·뒤뚱(y, z축 회전)을 머리에서 거꾸로 상쇄해 머리를 고정 (손떨림 방지 카메라처럼)
const vec3 PIVOT = vec3(${f3(PIVOT.x)}, ${f3(PIVOT.y)}, ${f3(PIVOT.z)});
float headWeight(vec3 p) { return smoothstep(0.1, 0.55, p.z) * smoothstep(-0.25, 0.1, p.y); }
vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
vec3 posePos(vec3 p, float limb) {
  float L = uLie;
  if (L < 0.0005 && uNod < 0.0005) return p;
  float wH = headWeight(p) * (1.0 - limb);
  float wHind = smoothstep(-0.25, -0.55, p.z) * smoothstep(-0.4, -0.55, p.y) * (1.0 - limb);
  float spreadW = smoothstep(0.4, -0.3, p.y);
  vec3 q = rotX(p - PIVOT, (${f3(HEAD_ANGLE)} * L + uNod) * wH) + PIVOT;
  q.y -= (${f3(HEAD_DROP)} * L + ${f3(NOD_DROP)} * uNod) * wH;
  q.x *= 1.0 - ${f3(LIMB_PINCH)} * L * limb;   // 앞발 모으기
  q.z -= ${f3(LIMB_TUCK)} * L * limb;          // 몸 밑으로 집어넣기
  q.z -= ${f3(HIND_STRETCH)} * L * wHind;      // 뒷발 뒤로
  q.x *= 1.0 + ${f3(SPREAD)} * L * spreadW;
  q.y = ${f3(FLOOR_Y)} + (q.y - ${f3(FLOOR_Y)}) * (1.0 - ${f3(FLATTEN)} * L);
  return q;
}
vec3 poseNormal(vec3 p, vec3 n, float limb) {
  float L = uLie;
  if (L < 0.0005 && uNod < 0.0005) return n;
  n = rotX(n, (${f3(HEAD_ANGLE)} * L + uNod) * headWeight(p) * (1.0 - limb));
  n.y /= 1.0 - ${f3(FLATTEN)} * L;
  return normalize(n);
}
vec3 legPivot(int i) {
  ${LEG_PIVOTS.map((v, i) => `if (i == ${i}) return vec3(${f3(v.x)}, ${f3(v.y)}, ${f3(v.z)});`).join('\n  ')}
  return vec3(0.0);
}
// 다리·꼬리 털 메시(SOLID)는 꼭짓점마다 다리 번호(aLeg, 꼬리는 -1)를 가진다
#ifdef SOLID
attribute float aLeg;
float limbW() { return (aLeg > -0.5 && aLeg < 1.5) ? 1.0 : 0.0; } // 앞다리만 엎드릴 때 모으고 집어넣음
#else
float limbW() { return 0.0; }
#endif
// 앉기: 가만히 있을 때 엉덩이 아래쪽을 바닥으로 내려 뒷다리를 가림 (뒤쪽·아래쪽일수록 많이)
float sitWeight(vec3 p) { return smoothstep(-0.25, -0.75, p.z) * smoothstep(0.35, -0.45, p.y); }
// 걷기: 다리는 회전축을 중심으로 앞뒤로 흔들고(아래쪽일수록 발을 많이 듦), 몸의 엉덩이 살은 뒷다리를 조금 따라감
vec3 walkPos(vec3 p) {
  // 엎드리면 몸 전체가 이미 납작해지므로, 엎드리는 만큼 엉덩이 내리기를 줄임 (겹치면 엉덩이가 바닥에 접혀 어두워짐)
  vec3 sit = vec3(0.0, -${f3(SIT_DROP)} * (1.0 - uStand) * (1.0 - uLie) * sitWeight(p), 0.0);
#ifdef SOLID
  if (aLeg < -0.5) return p + sit;   // 꼬리는 엉덩이를 따라 내려감
  int i = int(aLeg + 0.5);
  vec3 pv = legPivot(i);
  vec3 q = rotX(p - pv, uLegAngle[i]);
  float sa = uLegSpread[i] * sign(pv.x), sc = cos(sa), ss = sin(sa);      // 바깥쪽으로 벌리기
  q = vec3(q.x * sc - q.y * ss, q.x * ss + q.y * sc, q.z) + pv;
  q.y += uLegLift[i] * smoothstep(pv.y, ${f3(FLOOR_Y)}, p.y);
  return q;
#else
  // 몸통 살: 다리가 붙은 곳에 가까울수록, 아래쪽일수록 다리를 많이 따라감 (위쪽 등은 거의 그대로).
  // 좌우로는 범위를 좁혀서 한쪽 다리가 반대쪽 살을 끌고 가지 않게 함
  vec3 q = p + sit;
  for (int i = 0; i < 4; i++) {
    vec3 pv = legPivot(i), d = (p - pv) * vec3(1.7, 1.0, 1.0);
    float w = ${f3(BODY_FOLLOW)} * exp(-dot(d, d) / ${f3(BODY_FOLLOW_R2)}) * smoothstep(pv.y + 0.32, pv.y - 0.05, p.y);
    q = rotX(q - pv, uLegAngle[i] * w) + pv;
    if (i < 2) q.y += uLegLift[i] * w * 0.6 * smoothstep(pv.y + 0.32, pv.y - 0.1, p.y); // 앞발 위 가슴 살
  }
  // 엉덩이: 뒷다리가 들리면 같은 쪽 엉덩이 덩어리가 위쪽까지 통째로 살짝 들림 (좌우는 따로)
  ${RUMP_CENTERS.map((c, k) => `{ vec3 d = (p - vec3(${f3(c.x)}, ${f3(c.y)}, ${f3(c.z)})) * vec3(2.2, 0.85, 1.0);
    q.y += uLegLift[${k + 2}] * ${f3(RUMP_LIFT)} * exp(-dot(d, d) / ${f3(RUMP_R2)}); }`).join('\n  ')}
  // 머리 고정: 머리 쪽일수록 몸의 흔들림을 거꾸로 되돌림
  float wh = headWeight(p);
  q.y -= uHeadStab.x * wh;
  float ra = -uHeadStab.y * wh, rc = cos(ra), rs = sin(ra);
  q.xy = vec2(q.x * rc - q.y * rs, q.x * rs + q.y * rc);
  return q;
#endif
}
float bellyWeight(vec3 p) {
  float dz = (p.z + 0.3) / 0.6;
  return smoothstep(0.05, -0.35, p.y) * exp(-dz * dz);
}
vec3 softOffset(vec3 p, vec3 n) {
  vec3 o = vec3(n.x, 0.0, n.z * 0.5) * (uBreath * ${BREATH_AMP.toFixed(4)} * bellyWeight(p));
  for (int i = 0; i < ${GRABS}; i++) {
    vec3 g = p - uGrab[i];
    o += uPull[i] * exp(-dot(g, g) / ${f3(GRAB_R * GRAB_R)});
  }
  return o;
}
vec3 softPosition(vec3 p, vec3 n) {
  vec3 pp = posePos(walkPos(p), limbW());
  vec3 q = pp + softOffset(pp, n);
  q.y = max(q.y, min(pp.y, ${f3(FLOOR_Y + 0.02)}));
  return q;
}
`;

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const headWeight = (p) => sm(0.1, 0.55, p.z) * sm(-0.25, 0.1, p.y);

// 셰이더의 posePos와 같은 계산 (부품 위치·클릭 판정용)
export function posePos(p, lie, limb = 0, out = new THREE.Vector3(), nod = 0) {
  out.copy(p);
  if (lie < 0.0005 && nod < 0.0005) return out;
  const wH = headWeight(p) * (1 - limb);
  const wHind = sm(-0.25, -0.55, p.z) * sm(-0.4, -0.55, p.y) * (1 - limb);
  const spreadW = sm(0.4, -0.3, p.y);
  out.sub(PIVOT);
  const a = (HEAD_ANGLE * lie + nod) * wH, c = Math.cos(a), s = Math.sin(a);
  const y = out.y * c - out.z * s, z = out.y * s + out.z * c;
  out.set(out.x, y, z).add(PIVOT);
  out.y -= (HEAD_DROP * lie + NOD_DROP * nod) * wH;
  out.x *= 1 - LIMB_PINCH * lie * limb;
  out.z -= LIMB_TUCK * lie * limb;
  out.z -= HIND_STRETCH * lie * wHind;
  out.x *= 1 + SPREAD * lie * spreadW;
  out.y = FLOOR_Y + (out.y - FLOOR_Y) * (1 - FLATTEN * lie);
  return out;
}
// 그 점에서 머리가 숙여지는 각도 (부품 회전용)
export const poseAngle = (p, lie, nod = 0) => (HEAD_ANGLE * lie + nod) * headWeight(p);

// 머리 고정 (셰이더와 같은 계산): 걸을 때 몸의 통통(bob)·뒤뚱(roll)을 머리 쪽에서 거꾸로 상쇄. 부품이 돌아갈 각도를 돌려줌
export function stabilizeHead(p, bob, roll, out) {
  const wh = headWeight(p), a = -roll * wh, c = Math.cos(a), s = Math.sin(a);
  const x = out.x, y = out.y - bob * wh;
  out.x = x * c - y * s; out.y = x * s + y * c;
  return a;
}

// 앉을 때 엉덩이를 따라 내려가는 양 (꼬리 같은 부품용, 셰이더의 sit과 같은 계산)
export const sitDrop = (p, stand, lie) => -SIT_DROP * (1 - stand) * (1 - lie) * sm(-0.25, -0.75, p.z) * sm(0.35, -0.45, p.y);

// 셰이더의 walkPos와 같은 계산 (다리에 붙은 발 부품용). 돌린 각도도 돌려줌
export function walkPos(p, leg, angles, lifts, out = new THREE.Vector3(), spreads = null) {
  const pv = LEG_PIVOTS[leg], a = angles[leg], c = Math.cos(a), s = Math.sin(a);
  const x0 = p.x - pv.x, y = p.y - pv.y, z = p.z - pv.z;
  let x = x0, y1 = y * c - z * s;
  const z1 = y * s + z * c;
  const sa = (spreads ? spreads[leg] : 0) * Math.sign(pv.x), sc = Math.cos(sa), ss = Math.sin(sa); // 바깥쪽으로 벌리기
  [x, y1] = [x * sc - y1 * ss, x * ss + y1 * sc];
  out.set(pv.x + x, pv.y + y1, pv.z + z1);
  out.y += lifts[leg] * sm(pv.y, FLOOR_Y, p.y);
  return out;
}
// 다리를 바깥쪽으로 벌린 각도 (부품 회전용, z축)
export const legSpreadAngle = (leg, spreads) => spreads[leg] * Math.sign(LEG_PIVOTS[leg].x);

export function createSoftBody() {
  const uniforms = {
    uBreath: { value: 0 },
    uGrab: { value: Array.from({ length: GRABS }, () => new THREE.Vector3()) },
    uPull: { value: Array.from({ length: GRABS }, () => new THREE.Vector3()) },
    uLie: { value: 0 },
    uLegAngle: { value: new THREE.Vector4() },
    uLegLift: { value: new THREE.Vector4() },
    uLegSpread: { value: new THREE.Vector4() },
    uStand: { value: 0 },
    uNod: { value: 0 },
    uHeadStab: { value: new THREE.Vector2() },
  };
  // 잡는 곳마다: 잡고 있는지, 끌고 가려는 목표, 놓았을 때 돌아오는 속도
  const slots = Array.from({ length: GRABS }, () => ({ held: false, target: new THREE.Vector3(), vel: new THREE.Vector3() }));

  const bellyWeight = (p) => { const dz = (p.z + 0.3) / 0.6; return sm(0.05, -0.35, p.y) * Math.exp(-dz * dz); };

  return {
    uniforms,
    get held() { return slots.some((s) => s.held); },
    get stretch() { return Math.max(...uniforms.uPull.value.map((v) => v.length())); }, // 가장 많이 늘어난 곳

    // 비어 있는 자리 번호: 잡고 있지 않은 자리 중 가장 덜 늘어난 곳 (모두 잡고 있으면 -1)
    freeSlot() {
      let best = -1;
      slots.forEach((s, i) => {
        if (!s.held && (best < 0 || uniforms.uPull.value[i].lengthSq() < uniforms.uPull.value[best].lengthSq())) best = i;
      });
      return best;
    },

    grab(i, localPoint) {
      const s = slots[i];
      s.held = true; s.target.set(0, 0, 0); s.vel.set(0, 0, 0);
      uniforms.uGrab.value[i].copy(localPoint);
      uniforms.uPull.value[i].set(0, 0, 0);
    },
    drag(i, localOffset) {
      // 멀리 당길수록 덜 늘어나게 (부드러운 한계)
      const len = localOffset.length();
      slots[i].target.copy(localOffset).multiplyScalar(len > 1e-6 ? (MAX_PULL * Math.tanh(len / MAX_PULL)) / len : 0);
    },
    release(i) { slots[i].held = false; },

    update(dt, breath) {
      uniforms.uBreath.value = breath;
      slots.forEach((s, i) => {
        const pull = uniforms.uPull.value[i];
        if (s.held) {
          pull.lerp(s.target, Math.min(1, dt * 12));
          s.vel.set(0, 0, 0);
        } else {
          // 출렁이지 않고 부드럽게 제자리로 (임계 감쇠)
          const w = 7, steps = 4, h = dt / steps;
          for (let k = 0; k < steps; k++) {
            s.vel.addScaledVector(pull, -w * w * h).addScaledVector(s.vel, -2 * w * h);
            pull.addScaledVector(s.vel, h);
          }
          if (pull.lengthSq() < 1e-8) pull.set(0, 0, 0);
        }
      });
    },

    // 부품(눈·귀 등)이 몸과 함께 움직이도록 같은 변형을 JS로 계산
    offsetAt(p, out = new THREE.Vector3()) {
      out.set(0, 0, 0);
      for (let i = 0; i < GRABS; i++) {
        const g = p.distanceToSquared(uniforms.uGrab.value[i]);
        out.addScaledVector(uniforms.uPull.value[i], Math.exp(-g / (GRAB_R * GRAB_R)));
      }
      // 숨쉬기: 셰이더는 법선 방향으로 부풀리지만, 부품은 몸 중심에서 바깥쪽으로 근사
      const b = uniforms.uBreath.value * BREATH_AMP * bellyWeight(p);
      const r = Math.hypot(p.x, p.z) || 1;
      out.x += (p.x / r) * b; out.z += (p.z / r) * b * 0.5;
      return out;
    },
  };
}
