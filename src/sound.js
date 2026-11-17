// 소리 (Web Audio로 합성, 음원 파일 없음). 많이 잡아당겼을 때 찍찍 소리.
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
};
