// 털 렌더링 (셸 텍스처링).
// 몸 표면을 바깥쪽으로 SHELLS겹 겹쳐 그리고(한 번의 인스턴스 드로우), 셰이더가 겹마다
// 털 가닥의 단면만 남긴다. 겹이 바깥으로 갈수록 가닥이 가늘어지고 털 결 방향으로 눕는다.
//
// - 털 결: 기본은 코 → 엉덩이 방향. 쓰다듬은 방향은 comb 텍스처(UV 공간)에 기록되고 천천히 복원된다.
// - 손이 닿은 곳은 털이 눌린다(setTouch).
// - 색은 몸 좌표로 칠한 무늬(등·배·턱 밑·주둥이·엉덩이 아래)에, 털 뿌리 색(털 색마다 다름)을 더한다.
// - 다리·꼬리는 addLimbFur로 같은 털(배 색, 짧은 털)을 입힌다.
import * as THREE from 'three';
import { GLSL as SOFT_GLSL } from './softbody.js';
import { CENTER } from './hamster.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// back: 등 털끝 색, dark: 등줄기, belly: 배, root: 털 뿌리(안쪽) 색, rootAmt: 뿌리 색이 비치는 정도,
// bellyShift: 배 쪽 색이 옆구리 위로 올라오는 정도, rootEdge: [뿌리 색이 끝나기 시작하는 높이, 다 끝나는 높이] (털 길이 비율, 좁을수록 경계가 또렷)
export const COATS = {
  golden: { back: '#c98a4b', dark: '#a8692f', belly: '#e6bd85', root: '#7a4a22', rootAmt: 0.25, bellyShift: 0, rootEdge: [0.15, 0.85] },    // 배까지 노란 골든
  robo:   { back: '#977657', dark: '#6b5039', belly: '#f7f3ee', root: '#15110e', rootAmt: 1.0, bellyShift: 0.07, rootEdge: [0.56, 0.66] }, // 로보로스키: 흰 배, 등은 속은 검고 겉은 회갈색
  cream:  { back: '#efd9b8', dark: '#d8b88e', belly: '#fbf3e8', root: '#c9a679', rootAmt: 0.2, bellyShift: 0, rootEdge: [0.15, 0.85] },
  black:  { back: '#3a3330', dark: '#221d1b', belly: '#e9e2d9', root: '#141110', rootAmt: 0.4, bellyShift: 0, rootEdge: [0.15, 0.85] },
};

const SHELLS = 14; // 겹 수: 많을수록 촘촘하지만 GPU 부담(발열)이 커짐
const FUR_LEN = 0.09;
const DENSITY = 95;            // 단위 길이당 털 가닥 수
const COMB_W = 128, COMB_H = 64;
const COMB_RELAX = 7;          // 쓸어 넘긴 털이 원래대로 돌아오는 시간(초) 규모
const BRUSH_R = 0.16;          // 한 번 쓰다듬을 때 털 결이 바뀌는 범위
const GRAIN = new THREE.Vector3(0, -0.25, -1).normalize(); // 기본 털 결: 코 → 엉덩이

const HASH_GLSL = /* glsl */ `
float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 h33(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float vnoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z); }
`;

// 털 색 무늬 (꼭짓점마다 한 번만 계산해 픽셀 셰이더 부담을 줄임)
const COAT_GLSL = /* glsl */ `
uniform vec3 uBack, uDark, uBelly;
uniform float uBellyShift;
// rgb: 색, a: 배 쪽 무늬 비율 (털 뿌리 색을 배에는 적용하지 않으려고)
vec4 coatColor(vec3 p){
  float n = vnoise(p * 4.0) - 0.5;
  float belly  = smoothstep(-0.28, -0.46, p.y + n * 0.1 - uBellyShift);                  // 배
  float throat = smoothstep(0.25, 0.5, p.z) * smoothstep(0.12, -0.12, p.y + n * 0.08 - uBellyShift * 0.8); // 턱 밑·가슴
  float muzzle = smoothstep(0.92, 1.1, p.z + n * 0.06) * smoothstep(0.38, 0.22, p.y);   // 주둥이 아래·입 주변
  float rump   = smoothstep(-0.95, -1.15, p.z) * smoothstep(-0.1, -0.35, p.y);          // 엉덩이 아래
  float top    = smoothstep(0.35, 0.65, p.y + n * 0.15) * smoothstep(0.45, 0.0, p.z);   // 등줄기
  belly = max(belly, throat);
  vec3 c = mix(uBack, uDark, top * 0.45);
  float w = clamp(max(max(belly, muzzle), rump), 0.0, 1.0);
  return vec4(mix(c, uBelly, w), w);
}`;

const VERT = /* glsl */ `
${SOFT_GLSL}
${HASH_GLSL}
${COAT_GLSL}
uniform float uShells, uFurLen, uTime, uTouchAmt;
uniform vec3 uTouch, uGrain, uNose, uEyeL, uEyeR, uMouth;
uniform sampler2D uComb;
varying vec3 vBase, vN, vT, vWorld, vNl, vCoat;
varying float vH, vLenF, vBellyW;

// 눈·코·입 주변은 털을 짧게, 바닥 쪽도 조금 짧게
float furLen(vec3 p) {
#ifdef SOLID
  return mix(0.55, 1.0, smoothstep(-0.5, -0.26, p.y)); // 다리: 몸에 붙은 윗부분은 몸과 같은 길이, 아래로 갈수록 짧은 털
#endif
  float f = 1.0;
  f *= mix(0.35, 1.0, smoothstep(0.062, 0.1, distance(p, uEyeL)));
  f *= mix(0.35, 1.0, smoothstep(0.062, 0.1, distance(p, uEyeR)));
  f *= mix(0.4, 1.0, smoothstep(0.05, 0.14, distance(p, uNose)));
  f *= mix(0.2, 1.0, smoothstep(0.1, 0.28, distance(p, uMouth)));
  f *= mix(0.5, 1.0, smoothstep(-0.5, -0.38, p.y));
  return f;
}

void main() {
  float h = float(gl_InstanceID) / (uShells - 1.0);
  vec3 n0 = normalize(normal);
  vec3 base = softPosition(position, n0);
  vec3 n = poseNormal(position, n0, limbW());

  vec3 grain = uGrain - n * dot(uGrain, n);
#ifdef SOLID
  vec3 comb = vec3(0.0);
#else
  vec3 comb = texture2D(uComb, uv).xyz * 2.0 - 1.0;
#endif
  comb -= n * dot(comb, n);
  float cl = length(comb);
  // 결 반대로 쓸면 털이 일어섬
  float against = cl > 0.01 ? max(0.0, -dot(comb / cl, normalize(grain + 1e-4))) * cl : 0.0;

  float lf = furLen(position);
  float L = uFurLen * lf;
  float dT = distance(base, uTouch);
  float press = uTouchAmt * exp(-dT * dT / 0.02);

  vec3 wind = vec3(sin(uTime * 1.3 + position.x * 5.0), 0.0, cos(uTime * 1.1 + position.z * 4.0)) * 0.03;
  vec3 lay = grain * 0.55 + comb * 1.3 + vec3(0.0, -0.3, 0.0) + wind;
  lay -= n * dot(lay, n);

  float up = (1.0 - press * 0.7) * (1.0 + against * 0.6);
  float bend = pow(h, 1.6);
  vec3 p = base + n * (h * L * up) + lay * (L * bend * (1.0 + press) * (1.0 - against * 0.6));

  vT = normalize(mat3(modelMatrix) * (n * up + lay * (1.6 * sqrt(h) * (1.0 + press))));
  vN = normalize(mat3(modelMatrix) * n);
  vBase = position;
  vNl = n;
  vH = h;
  vLenF = lf;
  // 다리·꼬리도 몸과 같은 무늬를 써서, 몸에 붙은 윗부분은 몸 색으로 이어지고 아래로 갈수록 배 색이 됨
  vec4 cc = coatColor(position);
  vCoat = cc.rgb;
  vBellyW = cc.a;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
${HASH_GLSL}
uniform float uDensity;
uniform vec3 uL1, uL2, uRoot;
uniform float uRootAmt;
uniform vec2 uRootEdge;
varying vec3 vBase, vN, vT, vWorld, vNl, vCoat;
varying float vH, vLenF, vBellyW;

// 3D 격자 칸마다 털 한 가닥. 가닥마다 길이가 다르고 끝으로 갈수록 가늘다.
// 표면에 수직인 성분은 빼고 표면 위 거리만 재서, 격자를 비스듬히 자를 때 생기는 동심원 무늬를 없앤다.
float strand(vec3 p, vec3 nl, float h, out float id) {
  vec3 c = floor(p), f = fract(p);
  vec3 j = h33(c);
  id = h13(c + 17.0);
  float len = 0.6 + 0.4 * id;
  vec3 v = f - (0.35 + 0.3 * j);
  float d = length(v - nl * dot(v, nl));
  float fw = min(fwidth(d), 0.2) + 1e-4;
  float r = 0.66 * pow(max(0.0, 1.0 - h / len), 0.7); // 굵고, 끝에서만 가늘어짐
  return (1.0 - smoothstep(r - fw, r + fw, d)) * step(h, len);
}

// 격자 하나를 더 깔아 털 가닥을 늘림. 가장 진하게 덮는 가닥의 값(a)과 번호(id)를 남긴다.
void addLayer(mat3 R, float scale, vec3 offset, vec3 nl, float h, inout float a, inout float id) {
  float i;
  float v = strand(R * vBase * uDensity * scale + offset, R * nl, h, i);
  if (v > a) { a = v; id = i; }
}

void main() {
  float h = vH;
  vec3 nl = normalize(vNl);
  // 서로 다르게 돌린 격자 4개에 털을 심어 빽빽하게. 몸의 대칭면·축과 어긋나게 돌려서 줄무늬 자국을 막는다.
  float a = 0.0, id = 0.5;
  addLayer(mat3(0.788, 0.408, -0.461, -0.289, 0.902, 0.320, 0.545, -0.141, 0.827), 1.0,  vec3(0.0),            nl, h, a, id);
  addLayer(mat3(0.612, -0.612, 0.500, 0.780, 0.390, -0.489, 0.104, 0.688, 0.718), 1.37, vec3(11.3, 7.1, 3.7), nl, h, a, id);
  addLayer(mat3(0.354, 0.612, -0.707, -0.866, 0.500, 0.0, 0.354, 0.612, 0.707),   1.19, vec3(5.7, 2.3, 9.1),  nl, h, a, id);
  addLayer(mat3(0.433, -0.250, 0.866, 0.500, 0.866, 0.0, -0.750, 0.433, 0.500),   1.09, vec3(3.1, 8.3, 1.9),  nl, h, a, id);
  if (h < 0.1) { a = 1.0; id = 0.5; } // 맨 안쪽은 촘촘한 속털
  if (a < 0.04) discard;

  vec3 base = vCoat * (0.78 + 0.4 * id);
  // 털 뿌리 쪽은 뿌리 색 (로보로스키: 속은 검고 겉은 회갈색). 배에는 적용하지 않음
  base = mix(base, uRoot, uRootAmt * (1.0 - vBellyW) * (1.0 - smoothstep(uRootEdge.x, uRootEdge.y, h)));
  base = mix(base, min(base * 1.1 + 0.02, vec3(1.0)), smoothstep(0.5, 1.0, h)); // 끝은 조금 밝게

  vec3 T = normalize(vT), N = normalize(vN), V = normalize(cameraPosition - vWorld);
  vec3 L1 = normalize(uL1), L2 = normalize(uL2);
  float ao = mix(mix(0.2, 1.0, pow(h, 0.8)), 1.0, 1.0 - clamp(vLenF, 0.0, 1.0)); // 털 사이 그늘 (짧은 털은 거의 없음)
  float tl = dot(T, L1);
  float kaj = sqrt(max(0.0, 1.0 - tl * tl));               // 가닥 방향에 따른 빛 (Kajiya-Kay)
  float wrap = clamp(dot(N, L1) * 0.6 + 0.4, 0.0, 1.0);
  float fill = clamp(dot(N, L2) * 0.5 + 0.5, 0.0, 1.0);
  vec3 Hh = normalize(L1 + V);
  float th = dot(T, Hh);
  float spec = pow(sqrt(max(0.0, 1.0 - th * th)), 70.0) * 0.12 * wrap * h;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5) * 0.15 * h;

  vec3 col = base * (0.32 + 1.05 * wrap * mix(1.0, kaj, 0.45) * vec3(1.0, 0.96, 0.9) + 0.3 * fill * vec3(0.85, 0.9, 1.0)) * ao;
  col += spec * vec3(1.0, 0.95, 0.88) + rim * base;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createFur(bodyGeometry, anchors, softBody) {
  // 쓸어 넘긴 털 결 (몸 좌표 방향을 UV 공간 텍스처에 저장)
  const comb = new Float32Array(COMB_W * COMB_H * 3);
  const combBytes = new Uint8Array(COMB_W * COMB_H * 4).fill(128);
  for (let i = 3; i < combBytes.length; i += 4) combBytes[i] = 255;
  const combTex = new THREE.DataTexture(combBytes, COMB_W, COMB_H, THREE.RGBAFormat);
  combTex.wrapS = THREE.RepeatWrapping;
  combTex.magFilter = combTex.minFilter = THREE.LinearFilter;
  combTex.needsUpdate = true;
  let combDirty = false;

  // 털 색 uniform (setCoat으로 채움)
  const coat = {
    uBack: { value: new THREE.Color() },
    uDark: { value: new THREE.Color() },
    uBelly: { value: new THREE.Color() },
    uRoot: { value: new THREE.Color() },
    uRootAmt: { value: 0 },
    uBellyShift: { value: 0 },
    uRootEdge: { value: new THREE.Vector2() },
  };
  function setCoat(name) {
    const c = COATS[name];
    coat.uBack.value.set(c.back);
    coat.uDark.value.set(c.dark);
    coat.uBelly.value.set(c.belly);
    coat.uRoot.value.set(c.root);
    coat.uRootAmt.value = c.rootAmt;
    coat.uBellyShift.value = c.bellyShift;
    coat.uRootEdge.value.set(...c.rootEdge);
  }
  setCoat('golden');
  const uniforms = {
    ...softBody.uniforms,
    ...coat,
    uShells: { value: SHELLS },
    uFurLen: { value: FUR_LEN },
    uDensity: { value: DENSITY },
    uTime: { value: 0 },
    uTouch: { value: new THREE.Vector3(0, 99, 0) },
    uTouchAmt: { value: 0 },
    uGrain: { value: GRAIN },
    uNose: { value: anchors.nose },
    uEyeL: { value: anchors.eyeL },
    uEyeR: { value: anchors.eyeR },
    uMouth: { value: anchors.mouth },
    uComb: { value: combTex },
    uL1: { value: new THREE.Vector3(-2, 4, 3).normalize() },
    uL2: { value: new THREE.Vector3(3, 1, 2).normalize() },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, alphaToCoverage: true });
  const mesh = new THREE.InstancedMesh(bodyGeometry, material, SHELLS);
  mesh.frustumCulled = false; // 털과 늘어남 때문에 원래 경계를 벗어남

  let touchTarget = 0;

  return {
    mesh,
    setCoat,

    // 손이 닿은 곳의 털 눌림
    setTouch(localPoint, amount) {
      if (localPoint) uniforms.uTouch.value.copy(localPoint);
      touchTarget = amount;
    },

    // 쓸어 넘긴 방향을 붓으로 칠하듯 UV 텍스처에 기록
    comb(uv, dir, strength, local) {
      const cx = uv.x * COMB_W - 0.5, cy = uv.y * COMB_H - 0.5;
      const ringR = local ? Math.max(0.12, Math.hypot(local.x - CENTER.x, local.y - CENTER.y)) : 0.6;
      const ru = Math.min(40, (BRUSH_R * COMB_W) / (2 * Math.PI * ringR));
      const rv = (BRUSH_R * COMB_H) / (Math.PI * 1.1);
      for (let j = Math.floor(cy - rv); j <= Math.ceil(cy + rv); j++) {
        if (j < 0 || j >= COMB_H) continue;
        for (let i = Math.floor(cx - ru); i <= Math.ceil(cx + ru); i++) {
          const du = (i - cx) / ru, dv = (j - cy) / rv, r2 = du * du + dv * dv;
          if (r2 > 1) continue;
          const w = Math.exp(-r2 * 3) * strength * 0.35;
          const k = (j * COMB_W + (((i % COMB_W) + COMB_W) % COMB_W)) * 3;
          comb[k] += (dir.x - comb[k]) * w;
          comb[k + 1] += (dir.y - comb[k + 1]) * w;
          comb[k + 2] += (dir.z - comb[k + 2]) * w;
        }
      }
      combDirty = true;
    },

    // 다리·꼬리: 모양들을 몸 좌표로 합쳐 같은 털(배 색, 짧은 털)을 입힌 메시를 돌려줌. 원래 메시는 숨김.
    // furScale: 털 길이 배율. 다리 번호(userData.leg)가 있으면 걷기 동작을 따른다
    addLimbFur(limbs, { furScale = 1 } = {}) {
      const geos = [];
      for (const g of limbs) {
        g.updateMatrix();
        for (const m of g.children) {
          m.updateMatrix();
          const geo = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(g.matrix, m.matrix));
          // 걷기용 다리 번호 (꼬리는 -1)
          geo.setAttribute('aLeg', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count).fill(g.userData.leg ?? -1), 1));
          geos.push(geo);
        }
        g.visible = false;
      }
      const defines = { SOLID: 1 };
      const limbUniforms = { ...uniforms, uFurLen: { value: FUR_LEN * furScale } }; // 나머지 값은 몸과 공유
      const limbMat = new THREE.ShaderMaterial({ uniforms: limbUniforms, vertexShader: VERT, fragmentShader: FRAG, defines, alphaToCoverage: true });
      const limbMesh = new THREE.InstancedMesh(mergeGeometries(geos), limbMat, SHELLS);
      limbMesh.frustumCulled = false;
      return limbMesh;
    },

    update(dt, time) {
      uniforms.uTime.value = time;
      uniforms.uTouchAmt.value += (touchTarget - uniforms.uTouchAmt.value) * Math.min(1, dt * 10);
      if (!combDirty) return;
      // 털 결이 천천히 원래대로
      const decay = Math.exp(-dt / COMB_RELAX);
      let any = false;
      for (let t = 0, b = 0; t < comb.length; t += 3, b += 4) {
        for (let c = 0; c < 3; c++) {
          const v = (comb[t + c] *= decay);
          if (Math.abs(v) > 0.004) any = true;
          combBytes[b + c] = Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)));
        }
      }
      combTex.needsUpdate = true;
      combDirty = any;
    },
  };
}
