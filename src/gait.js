// 걸음: 걷는 속도에 맞춰 네 다리의 각도·발 들기·벌리기와 몸의 통통·뒤뚱을 계산한다.
//
// - 대각선 다리(왼앞+오른뒤, 오른앞+왼뒤)가 번갈아 앞뒤로 흔들리고, 앞으로 내딛는 발은 살짝 듦
// - 매달렸을 때(hangAmt)는 다리가 아래로 축 늘어져 버둥거리고, 앞발은 양옆으로 활짝 벌림
// - 머리는 몸의 흔들림 대부분을 거꾸로 상쇄해 거의 고정 (완전히 멈추면 어색해서 조금은 따라감)
// 다리 번호: 0·1 앞다리(왼·오른), 2·3 뒷다리(왼·오른)

export const WALK_SPEED = 0.5;   // 보통 걷는 속도 (몸 길이 단위/초)
const STEP_HZ = 2.2;              // 걸음 빠르기 (보통 속도일 때 1초에 몇 걸음 주기)
const LEG_SWING = 0.38;           // 다리를 앞뒤로 흔드는 최대 각도
const FOOT_LIFT = 0.05;           // 발을 드는 최대 높이
const LEG_PHASE = [0, Math.PI, Math.PI, 0];
const BOB = 0.03, ROLL = 0.045;   // 걸음마다 몸이 통통 튀는 높이, 좌우로 뒤뚱거리는 각도
const HEAD_STAB = 0.7;            // 머리에서 몸 흔들림을 상쇄하는 비율

export function createGait() {
  const g = {
    speed: 0, phase: 0, stride: 0,
    angles: [0, 0, 0, 0], lifts: [0, 0, 0, 0], spreads: [0, 0, 0, 0],
    bob: 0, roll: 0, headBob: 0, headRoll: 0,
  };

  g.update = (dt, t, targetSpeed, hangAmt) => {
    g.speed += (targetSpeed - g.speed) * Math.min(1, dt * 3);
    g.stride = Math.min(1.5, g.speed / WALK_SPEED);
    g.phase += dt * Math.PI * 2 * STEP_HZ * g.stride;

    for (let i = 0; i < 4; i++) {
      const ph = g.phase + LEG_PHASE[i];
      let angle = LEG_SWING * g.stride * Math.sin(ph);            // +: 발이 뒤로 (땅을 밀어냄)
      let lift = FOOT_LIFT * g.stride * Math.max(0, -Math.cos(ph)); // 앞으로 내딛는 동안 발을 듦
      // 매달렸을 때: 아래로 축 늘어져 살짝 버둥거림 (뒷다리는 더 아래로)
      const dangle = (i < 2 ? 0.15 : 0.95) + 0.12 * Math.sin(t * (4.5 + i * 0.9) + i);
      angle += (dangle - angle) * hangAmt;
      lift *= 1 - hangAmt;
      g.angles[i] = angle;
      g.lifts[i] = lift;
      // 매달렸을 때 앞발은 양옆으로 활짝, 뒷발은 조금 벌림
      g.spreads[i] = hangAmt * ((i < 2 ? 1.0 : 0.35) + 0.08 * Math.sin(t * (3.7 + i) + i * 2));
    }

    g.bob = BOB * g.stride * Math.abs(Math.sin(g.phase));
    g.roll = ROLL * g.stride * Math.sin(g.phase);
    g.headBob = g.bob * HEAD_STAB;
    g.headRoll = g.roll * HEAD_STAB;
    return g;
  };
  return g;
}
