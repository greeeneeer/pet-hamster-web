// 소리 (Web Audio로 합성, 음원 파일 없음). 많이 잡아당겼을 때 찍찍 소리, 성질낼 때 캬악 소리.
let ctx = null;
let enabled = true;

export const sound = {
  unlock() { ctx ??= new AudioContext(); if (ctx.state === 'suspended') ctx.resume(); },
  toggle() { enabled = !enabled; return enabled; },
  squeak() {
    if (!enabled || !ctx) return;
    const t0 = ctx.currentTime;
    for (let k = 0; k < 2; k++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), s = t0 + k * 0.11;
      o.type = 'triangle';
      o.frequency.setValueAtTime(2600, s);
      o.frequency.exponentialRampToValueAtTime(4200, s + 0.04);
      o.frequency.exponentialRampToValueAtTime(3000, s + 0.09);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.15, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.09);
      o.connect(g).connect(ctx.destination);
      o.start(s); o.stop(s + 0.1);
    }
  },
  // 짧게 바람 새는 듯한 "캬악" (걸러 낸 잡음)
  hiss() {
    if (!enabled || !ctx) return;
    const t0 = ctx.currentTime, len = 0.35;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf;
    bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(2200, t0);
    bp.frequency.exponentialRampToValueAtTime(4200, t0 + len);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(t0); src.stop(t0 + len);
  },
};
