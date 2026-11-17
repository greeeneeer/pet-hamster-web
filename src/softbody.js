// 몸이 말랑하게 변하는 부분: 배 쪽 숨쉬기, 잡아당기기와 놓았을 때 부드럽게 돌아오기, 엎드린 자세.
// 같은 계산을 셰이더(몸·털)와 JS(눈·귀 같은 부품 위치)에서 똑같이 쓴다.
import * as THREE from 'three';
import { FLOOR_Y } from './hamster.js';

const GRAB_R = 0.42;   // 잡은 곳 주변으로 늘어나는 범위
const MAX_PULL = 0.32; // 이 이상은 잘 안 늘어남
const BREATH_AMP = 0.022;

// 엎드린 자세 (uLie: 0 = 서 있음, 1 = 바닥에 납작 엎드림)
//  - 머리: 목 근처를 축으로 고개를 숙이고 아래로 내림
//  - 앞다리(LIMB): 가운데로 모으며 몸 밑으로 집어넣음
//  - 뒷발: 뒤로 뻗음
//  - 전체: 바닥 쪽으로 납작하게 눌리며 옆으로 퍼짐
const PIVOT = new THREE.Vector3(0, 0.1, 0.25);
const HEAD_ANGLE = 0.5, HEAD_DROP = 0.12, FLATTEN = 0.38, SPREAD = 0.16;

export const GLSL = /* glsl */ `
uniform float uBreath;
uniform vec3 uGrab;
uniform vec3 uPull;
uniform float uLie;
const vec3 PIVOT = vec3(${PIVOT.x.toFixed(3)}, ${PIVOT.y.toFixed(3)}, ${PIVOT.z.toFixed(3)});
float headWeight(vec3 p) { return smoothstep(0.1, 0.55, p.z) * smoothstep(-0.25, 0.1, p.y); }
vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
vec3 posePos(vec3 p, float limb) {
  float L = uLie;
  if (L < 0.0005) return p;
  float wH = headWeight(p) * (1.0 - limb);
  float wHind = smoothstep(-0.25, -0.55, p.z) * smoothstep(-0.4, -0.55, p.y) * (1.0 - limb);
  float spreadW = smoothstep(0.4, -0.3, p.y);
  vec3 q = rotX(p - PIVOT, ${HEAD_ANGLE.toFixed(3)} * L * wH) + PIVOT;
  q.y -= ${HEAD_DROP.toFixed(3)} * L * wH;
  q.x *= 1.0 - 0.45 * L * limb;           // 앞발 모으기
  q.z -= 0.12 * L * limb;                  // 몸 밑으로 집어넣기 (엎드리면 앞발은 안 보임)
  q.z -= 0.22 * L * wHind;                 // 뒷발 뒤로
  q.x *= 1.0 + ${SPREAD.toFixed(3)} * L * spreadW;
  q.y = ${FLOOR_Y.toFixed(3)} + (q.y - ${FLOOR_Y.toFixed(3)}) * (1.0 - ${FLATTEN.toFixed(3)} * L);
  return q;
}
vec3 poseNormal(vec3 p, vec3 n, float limb) {
  float L = uLie;
  if (L < 0.0005) return n;
  n = rotX(n, ${HEAD_ANGLE.toFixed(3)} * L * headWeight(p) * (1.0 - limb));
  n.y /= 1.0 - ${FLATTEN.toFixed(3)} * L;
  return normalize(n);
}
float bellyWeight(vec3 p) {
  float dz = (p.z + 0.3) / 0.6;
  return smoothstep(0.05, -0.35, p.y) * exp(-dz * dz);
}
vec3 softOffset(vec3 p, vec3 n) {
  vec3 o = vec3(n.x, 0.0, n.z * 0.5) * (uBreath * ${BREATH_AMP.toFixed(4)} * bellyWeight(p));
  vec3 g = p - uGrab;
  o += uPull * exp(-dot(g, g) / ${(GRAB_R * GRAB_R).toFixed(4)});
  return o;
}
#ifdef SOLID
const float LIMB = 1.0;
#else
const float LIMB = 0.0;
#endif
vec3 softPosition(vec3 p, vec3 n) {
  vec3 pp = posePos(p, LIMB);
  vec3 q = pp + softOffset(pp, n);
  q.y = max(q.y, min(pp.y, ${(FLOOR_Y + 0.02).toFixed(3)}));
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
  out.x *= 1 - 0.45 * lie * limb;
  out.z -= 0.12 * lie * limb;
  out.z -= 0.22 * lie * wHind;
  out.x *= 1 + SPREAD * lie * spreadW;
  out.y = FLOOR_Y + (out.y - FLOOR_Y) * (1 - FLATTEN * lie);
  return out;
}
// 그 점에서 머리가 숙여지는 각도 (부품 회전용)
export const poseAngle = (p, lie) => HEAD_ANGLE * lie * headWeight(p);

export function createSoftBody() {
  const uniforms = {
    uBreath: { value: 0 },
    uGrab: { value: new THREE.Vector3(0, 0, 0) },
    uPull: { value: new THREE.Vector3() },
    uLie: { value: 0 },
  };
  const vel = new THREE.Vector3();
  const target = new THREE.Vector3();
  let held = false;

  const bellyWeight = (p) => { const dz = (p.z + 0.3) / 0.6; const t = Math.min(1, Math.max(0, (0.05 - p.y) / 0.4)); return t * t * (3 - 2 * t) * Math.exp(-dz * dz); };

  return {
    uniforms,
    get held() { return held; },
    get stretch() { return uniforms.uPull.value.length(); },

    grab(localPoint) { held = true; uniforms.uGrab.value.copy(localPoint); uniforms.uPull.value.set(0, 0, 0); vel.set(0, 0, 0); target.set(0, 0, 0); },
    drag(localOffset) {
      // 멀리 당길수록 덜 늘어나게 (부드러운 한계)
      const len = localOffset.length();
      target.copy(localOffset).multiplyScalar(len > 1e-6 ? (MAX_PULL * Math.tanh(len / MAX_PULL)) / len : 0);
    },
    release() { held = false; },

    update(dt, breath) {
      uniforms.uBreath.value = breath;
      const pull = uniforms.uPull.value;
      if (held) {
        pull.lerp(target, Math.min(1, dt * 12));
        vel.set(0, 0, 0);
      } else {
        // 출렁이지 않고 부드럽게 제자리로 (임계 감쇠)
        const w = 7, steps = 4, h = dt / steps;
        for (let i = 0; i < steps; i++) {
          vel.addScaledVector(pull, -w * w * h).addScaledVector(vel, -2 * w * h);
          pull.addScaledVector(vel, h);
        }
      }
    },

    // 부품(눈·귀 등)이 몸과 함께 움직이도록 같은 변형을 JS로 계산
    offsetAt(p, out = new THREE.Vector3()) {
      const g = p.distanceToSquared(uniforms.uGrab.value);
      out.copy(uniforms.uPull.value).multiplyScalar(Math.exp(-g / (GRAB_R * GRAB_R)));
      const b = uniforms.uBreath.value * BREATH_AMP * bellyWeight(p);
      const r = Math.hypot(p.x, p.z) || 1;
      out.x += (p.x / r) * b; out.z += (p.z / r) * b * 0.5;
      return out;
    },
  };
}
