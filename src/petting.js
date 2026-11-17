// 마우스/터치 입력.
//
// 마우스
// - 버튼을 누르지 않고 몸 위로 움직이면: 쓰다듬기 (onStroke)
// - 왼쪽 버튼으로 몸을 잡고 끌면: 잡아당기기 (onGrab → onDrag → onRelease)
// - 오른쪽 드래그·휠: 돌려보기·확대 (OrbitControls)
//
// 터치 (휴대폰)
// - 햄스터 위를 한 손가락으로 쓸기: 쓰다듬기
// - 햄스터를 길게 누른 뒤 끌기: 잡아당기기. 손가락마다 따로 잡을 수 있어서 양 볼을 동시에 당길 수 있다
//   (동시에 잡을 수 있는 곳 수는 onGrab이 정함). 잡고 있는 동안은 돌려보기·확대가 멈춘다.
// - 햄스터 바깥을 한 손가락으로 끌기: 돌려보기 (OrbitControls)
// - 두 손가락 벌리기/오므리기: 확대·축소 (OrbitControls)
//
// onGrab(hit)은 잡은 자리 번호를 돌려준다(-1이면 더 잡을 수 없음). onDrag(점, 번호), onRelease(번호).
import * as THREE from 'three';

const LONG_PRESS_MS = 350;   // 이만큼 가만히 누르고 있으면 잡기
const MOVE_TOLERANCE = 10;   // 길게 누르기로 인정하는 손가락 흔들림(px)

export function createPetting({ canvas, camera, hitMesh, controls, onStroke, onHover, onGrab, onDrag, onRelease }) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tmp = new THREE.Vector3();
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
    return { world: hit.point, local: hitMesh.worldToLocal(hit.point.clone()), normal: hit.face.normal.clone(), uv: hit.uv.clone(), face: hit.face };
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

  // 잡기: 잡은 점을 지나고 카메라를 바라보는 평면 위에서 끈다. 성공하면 { slot, plane }을 돌려줌
  function beginGrab(hit) {
    const slot = onGrab?.(hit) ?? -1;
    if (slot < 0) return null;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(tmp).negate(), hit.world);
    return { slot, plane };
  }
  function dragTo(e, grab) {
    setRay(e);
    const p = raycaster.ray.intersectPlane(grab.plane, new THREE.Vector3());
    if (p) onDrag?.(p, grab.slot);
  }

  // ── 터치 ──────────────────────────────────────────
  // 손가락마다 상태를 따로 둔다: pending(누르고 기다리는 중) → grab(잡음) / stroke(쓰다듬기) / none(확대·돌려보기에 맡김)
  // OrbitControls보다 먼저(capture) 받아서, 햄스터 위를 짚었는지에 따라 한 손가락 돌려보기를 켜고 끈다.
  const fingers = new Map();
  const grabbingCount = () => [...fingers.values()].filter((f) => f.mode === 'grab').length;
  const updateControls = () => { controls.enabled = grabbingCount() === 0; };

  function endFinger(id) {
    const f = fingers.get(id);
    if (!f) return;
    clearTimeout(f.timer);
    if (f.mode === 'grab') onRelease?.(f.grab.slot);
    if (f.mode === 'stroke' || f.mode === 'pending') onHover?.(null);
    fingers.delete(id);
    if (f.mode === 'stroke') prev = null;
    updateControls();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    // 두 번째 손가락이 오면 쓰다듬던 손가락은 쓰다듬기를 멈춤 (확대나 다른 잡기로 넘어감)
    for (const f of fingers.values()) if (f.mode === 'stroke') { f.mode = 'none'; prev = null; onHover?.(null); }
    const hit = hitAt(e);
    if (fingers.size === 0) controls.touches.ONE = hit ? null : THREE.TOUCH.ROTATE;
    const f = { mode: hit ? 'pending' : 'none', start: { x: e.clientX, y: e.clientY }, hit, timer: 0, grab: null };
    fingers.set(e.pointerId, f);
    if (!hit) return;
    if (fingers.size === 1) onHover?.(hit);
    f.timer = setTimeout(() => {
      if (f.mode !== 'pending') return;
      f.grab = beginGrab(f.hit);
      if (!f.grab) { f.mode = 'none'; return; }
      f.mode = 'grab';
      navigator.vibrate?.(15);
      updateControls();
    }, LONG_PRESS_MS);
  }, { capture: true });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') return;
    const f = fingers.get(e.pointerId);
    if (!f) return;
    if (f.mode === 'pending' && Math.hypot(e.clientX - f.start.x, e.clientY - f.start.y) > MOVE_TOLERANCE) {
      clearTimeout(f.timer);
      // 혼자 움직이면 쓰다듬기, 다른 손가락과 함께면 확대·돌려보기에 맡김
      f.mode = fingers.size === 1 ? 'stroke' : 'none';
      if (f.mode === 'stroke') strokeStep(f.hit);
    }
    if (f.mode === 'stroke') {
      const hit = hitAt(e);
      onHover?.(hit);
      strokeStep(hit);
    } else if (f.mode === 'grab') {
      dragTo(e, f.grab);
    }
  });

  const touchEnd = (e) => { if (e.pointerType === 'touch') endFinger(e.pointerId); };
  canvas.addEventListener('pointerup', touchEnd);
  canvas.addEventListener('pointercancel', touchEnd);

  // ── 마우스 ────────────────────────────────────────
  let mouseGrab = null, mouseId = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const hit = hitAt(e);
    if (!hit) return;
    mouseGrab = beginGrab(hit);
    if (mouseGrab) { mouseId = e.pointerId; canvas.style.cursor = 'grabbing'; prev = null; }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    if (mouseGrab) { if (e.pointerId === mouseId) dragTo(e, mouseGrab); return; }
    const hit = hitAt(e);
    canvas.style.cursor = hit ? 'grab' : 'default';
    onHover?.(hit);
    strokeStep(hit);
  });

  const mouseEnd = (e) => {
    if (e.pointerType === 'touch' || !mouseGrab || e.pointerId !== mouseId) return;
    onRelease?.(mouseGrab.slot);
    mouseGrab = null; mouseId = null;
    canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerup', mouseEnd);
  canvas.addEventListener('pointercancel', mouseEnd);
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'touch') return;
    mouseEnd(e); onHover?.(null); prev = null;
  });
}
