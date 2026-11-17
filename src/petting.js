// 마우스/터치 입력.
//
// 마우스
// - 버튼을 누르지 않고 몸 위로 움직이면: 쓰다듬기 (onStroke)
// - 왼쪽 버튼으로 몸을 잡고 끌면: 잡아당기기 (onGrab → onDrag → onRelease)
// - 오른쪽 드래그·휠: 돌려보기·확대 (OrbitControls)
//
// 터치 (휴대폰)
// - 햄스터 위를 한 손가락으로 쓸기: 쓰다듬기
// - 햄스터를 길게 누른 뒤 끌기: 잡아당기기
// - 햄스터 바깥을 한 손가락으로 끌기: 돌려보기 (OrbitControls)
// - 두 손가락 벌리기/오므리기: 확대·축소 (OrbitControls)
import * as THREE from 'three';

const LONG_PRESS_MS = 350;   // 이만큼 가만히 누르고 있으면 잡기
const MOVE_TOLERANCE = 10;   // 길게 누르기로 인정하는 손가락 흔들림(px)

export function createPetting({ canvas, camera, hitMesh, controls, onStroke, onHover, onGrab, onDrag, onRelease }) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const tmp = new THREE.Vector3();
  let grabbing = false, grabPointerId = null;
  let prev = null, prevTime = 0;

  function setRay(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }
  function hitAt(e) {
    setRay(e);
    const hit = raycaster.intersectObject(hitMesh, false)[0];
    if (!hit) return null;
    return { world: hit.point, local: hitMesh.worldToLocal(hit.point.clone()), normal: hit.face.normal.clone(), uv: hit.uv.clone() };
  }

  // 몸 위에서 움직인 만큼 쓰다듬기로 보냄
  function strokeStep(hit) {
    if (!hit) { prev = null; return; }
    const now = performance.now();
    if (prev) {
      const delta = hit.local.clone().sub(prev);
      delta.addScaledVector(hit.normal, -delta.dot(hit.normal)); // 표면을 따라가는 성분만
      const dist = delta.length();
      if (dist > 1e-4) {
        const dt = Math.max(1e-3, (now - prevTime) / 1000);
        onStroke?.({ ...hit, dir: delta.normalize(), dist, speed: dist / dt });
      }
    }
    prev = hit.local; prevTime = now;
  }

  function beginGrab(pointerId, hit) {
    grabbing = true; grabPointerId = pointerId; prev = null;
    // 잡은 점을 지나고 카메라를 바라보는 평면 위에서 끌기
    plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(tmp).negate(), hit.world);
    canvas.style.cursor = 'grabbing';
    onGrab?.(hit);
  }
  function dragTo(e) {
    setRay(e);
    const p = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (p) onDrag?.(p);
  }
  function endGrab() {
    if (!grabbing) return;
    grabbing = false; grabPointerId = null;
    canvas.style.cursor = 'grab';
    onRelease?.();
  }

  // ── 터치 ──────────────────────────────────────────
  // OrbitControls보다 먼저(capture) 받아서, 햄스터 위를 짚었는지에 따라 한 손가락 돌려보기를 켜고 끈다.
  const touches = new Set();
  let tId = null, tMode = null, tStart = null, tHit = null, tTimer = 0;

  function cancelTouchGesture() {
    clearTimeout(tTimer);
    if (tMode === 'grab') endGrab();
    if (tMode) onHover?.(null);
    tMode = null; tId = null; prev = null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    touches.add(e.pointerId);
    if (touches.size > 1) { cancelTouchGesture(); return; } // 두 손가락: 확대·축소에 맡김
    const hit = hitAt(e);
    controls.touches.ONE = hit ? null : THREE.TOUCH.ROTATE;
    if (!hit) return;
    tId = e.pointerId; tMode = 'pending'; tStart = { x: e.clientX, y: e.clientY }; tHit = hit; prev = null;
    onHover?.(hit);
    tTimer = setTimeout(() => {
      if (tMode !== 'pending') return;
      tMode = 'grab';
      navigator.vibrate?.(15);
      beginGrab(tId, tHit);
    }, LONG_PRESS_MS);
  }, { capture: true });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch' || e.pointerId !== tId) return;
    if (tMode === 'pending' && Math.hypot(e.clientX - tStart.x, e.clientY - tStart.y) > MOVE_TOLERANCE) {
      clearTimeout(tTimer);
      tMode = 'stroke';
      strokeStep(tHit);
    }
    if (tMode === 'stroke') {
      const hit = hitAt(e);
      onHover?.(hit);
      strokeStep(hit);
    } else if (tMode === 'grab') {
      dragTo(e);
    }
  });

  const touchEnd = (e) => {
    if (e.pointerType !== 'touch') return;
    touches.delete(e.pointerId);
    if (e.pointerId === tId) cancelTouchGesture();
  };
  canvas.addEventListener('pointerup', touchEnd);
  canvas.addEventListener('pointercancel', touchEnd);

  // ── 마우스 ────────────────────────────────────────
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const hit = hitAt(e);
    if (hit) beginGrab(e.pointerId, hit);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    if (grabbing) { if (e.pointerId === grabPointerId) dragTo(e); return; }
    const hit = hitAt(e);
    canvas.style.cursor = hit ? 'grab' : 'default';
    onHover?.(hit);
    strokeStep(hit);
  });

  const mouseEnd = (e) => {
    if (e.pointerType === 'touch' || e.pointerId !== grabPointerId) return;
    endGrab();
  };
  canvas.addEventListener('pointerup', mouseEnd);
  canvas.addEventListener('pointercancel', mouseEnd);
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'touch') return;
    mouseEnd(e); onHover?.(null); prev = null;
  });

  return { get grabbing() { return grabbing; } };
}
