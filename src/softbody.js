// 몸이 말랑하게 변하는 부분: 배 쪽 숨쉬기, 잡아당기기(손가락마다 최대 GRABS곳)와 놓았을 때 부드럽게 돌아오기, 엎드린 자세.
// 같은 계산을 셰이더(몸·털)와 JS(눈·귀 같은 부품 위치)에서 똑같이 쓴다.
import * as THREE from 'three';
import { FLOOR_Y } from './hamster.js';

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
const f3 = (x) => x.toFixed(3);

export const GLSL = /* glsl */ `
uniform float uBreath;
uniform vec3 uGrab[${GRABS}];
uniform vec3 uPull[${GRABS}];
uniform float uLie;
const vec3 PIVOT = vec3(${f3(PIVOT.x)}, ${f3(PIVOT.y)}, ${f3(PIVOT.z)});
float headWeight(vec3 p) { return smoothstep(0.1, 0.55, p.z) * smoothstep(-0.25, 0.1, p.y); }
vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
vec3 posePos(vec3 p, float limb) {
  float L = uLie;
  if (L < 0.0005) return p;
  float wH = headWeight(p) * (1.0 - limb);
  float wHind = smoothstep(-0.25, -0.55, p.z) * smoothstep(-0.4, -0.55, p.y) * (1.0 - limb);
  float spreadW = smoothstep(0.4, -0.3, p.y);
  vec3 q = rotX(p - PIVOT, ${f3(HEAD_ANGLE)} * L * wH) + PIVOT;
  q.y -= ${f3(HEAD_DROP)} * L * wH;
  q.x *= 1.0 - ${f3(LIMB_PINCH)} * L * limb;   // 앞발 모으기
  q.z -= ${f3(LIMB_TUCK)} * L * limb;          // 몸 밑으로 집어넣기
  q.z -= ${f3(HIND_STRETCH)} * L * wHind;      // 뒷발 뒤로
  q.x *= 1.0 + ${f3(SPREAD)} * L * spreadW;
  q.y = ${f3(FLOOR_Y)} + (q.y - ${f3(FLOOR_Y)}) * (1.0 - ${f3(FLATTEN)} * L);
  return q;
}
vec3 poseNormal(vec3 p, vec3 n, float limb) {
  float L = uLie;
  if (L < 0.0005) return n;
  n = rotX(n, ${f3(HEAD_ANGLE)} * L * headWeight(p) * (1.0 - limb));
  n.y /= 1.0 - ${f3(FLATTEN)} * L;
  return normalize(n);
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
// SOLID: 다리·꼬리 털 메시, TAIL: 꼬리 (엎드릴 때 다리 자세를 따르지 않음)
#if defined(SOLID) && !defined(TAIL)
const float LIMB = 1.0;
#else
const float LIMB = 0.0;
#endif
vec3 softPosition(vec3 p, vec3 n) {
  vec3 pp = posePos(p, LIMB);
  vec3 q = pp + softOffset(pp, n);
  q.y = max(q.y, min(pp.y, ${f3(FLOOR_Y + 0.02)}));
  return q;
}
`;

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const headWeight = (p) => sm(0.1, 0.55, p.z) * sm(-0.25, 0.1, p.y);

// 셰이더의 posePos와 같은 계산 (부품 위치·클릭 판정용)
export function posePos(p, lie, limb = 0, out = new THREE.Vector3()) {
  out.copy(p);
  if (lie < 0.0005) return out;
  const wH = headWeight(p) * (1 - limb);
  const wHind = sm(-0.25, -0.55, p.z) * sm(-0.4, -0.55, p.y) * (1 - limb);
  const spreadW = sm(0.4, -0.3, p.y);
  out.sub(PIVOT);
  const a = HEAD_ANGLE * lie * wH, c = Math.cos(a), s = Math.sin(a);
  const y = out.y * c - out.z * s, z = out.y * s + out.z * c;
  out.set(out.x, y, z).add(PIVOT);
  out.y -= HEAD_DROP * lie * wH;
  out.x *= 1 - LIMB_PINCH * lie * limb;
  out.z -= LIMB_TUCK * lie * limb;
  out.z -= HIND_STRETCH * lie * wHind;
  out.x *= 1 + SPREAD * lie * spreadW;
  out.y = FLOOR_Y + (out.y - FLOOR_Y) * (1 - FLATTEN * lie);
  return out;
}
// 그 점에서 머리가 숙여지는 각도 (부품 회전용)
export const poseAngle = (p, lie) => HEAD_ANGLE * lie * headWeight(p);

export function createSoftBody() {
  const uniforms = {
    uBreath: { value: 0 },
    uGrab: { value: Array.from({ length: GRABS }, () => new THREE.Vector3()) },
    uPull: { value: Array.from({ length: GRABS }, () => new THREE.Vector3()) },
    uLie: { value: 0 },
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
