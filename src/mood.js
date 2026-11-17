// 햄스터의 기분. 쓰다듬는 방식에 따라 좋아함(happy)·싫어함(annoyed)이 오르내린다.
// '너무 좋아요…'(happy > 0.7) 상태에서 계속 쓰다듬으면 엎드리고(lying),
// 한동안 손길이 없으면 다시 일어난다. 목덜미를 잡아 들었다 내려놓으면 처음 기분으로 돌아간다.
// '끙…'(annoyed > 0.6)이 한동안 이어지면 성질을 내며 입을 크게 벌린다(tantrum). 쌓인 좋은 기분은 그대로 둔다.
import * as THREE from 'three';

const GRAIN = new THREE.Vector3(0, -0.3, -1).normalize(); // 털 결: 코 → 엉덩이
const BLISS_TO_LIE = 2.5;  // '너무 좋아요' 상태에서 이만큼(몸 길이 단위) 더 쓰다듬으면 엎드림
const IDLE_TO_STAND = 6;   // 엎드린 뒤 이 시간(초) 동안 손길이 없으면 일어남
const GRUMP_TO_TANTRUM = 2; // '끙…'이 이만큼(초) 이어지면 성질냄
export const TANTRUM_TIME = 1.1; // 성질내는 동작 길이(초)
const TANTRUM_COOLDOWN = 3;  // 성질낸 뒤 다시 낼 때까지 쉬는 시간(초)

export function createMood({ onTantrum } = {}) {
  const s = { happy: 0, annoyed: 0, petting: false, held: false, lying: false, bliss: 0, idle: 0, grumpT: 0, tantrum: 0, tantrumCool: 0 };

  const standUp = () => { s.lying = false; s.bliss = 0; };

  return {
    state: s,
    // 처음 기분으로 (들어올렸다 내려놓았을 때: 정신이 번쩍 들어 쌓인 기분이 사라짐)
    reset() { Object.assign(s, { happy: 0, annoyed: 0, lying: false, bliss: 0, grumpT: 0 }); },
    stroke({ local, normal, dir, dist, speed }) {
      const grain = GRAIN.clone().addScaledVector(normal, -GRAIN.dot(normal)).normalize();
      const along = dir.dot(grain);
      if (speed > 6 || along < -0.35) {
        s.annoyed += dist * 0.6;
      } else {
        s.idle = 0;
        if (s.happy > 0.7) {
          s.bliss += dist;
          if (s.bliss > BLISS_TO_LIE) s.lying = true;
        }
        s.happy = Math.min(1, s.happy + dist * (local.z > 0.55 ? 0.22 : 0.14));
      }
      s.annoyed = Math.min(1.2, s.annoyed); // 싫어도 '끙…' 하고 말 뿐, 쌓인 기분은 그대로
    },
    update(dt) {
      s.idle += dt;
      // 엎드려 있는 동안은 기분이 거의 그대로 유지됨
      s.happy = Math.max(0, s.happy - dt * (s.lying ? 0.005 : 0.04));
      s.annoyed = Math.max(0, s.annoyed - dt * 0.5);
      if (s.lying && s.idle > IDLE_TO_STAND) standUp();
      if (!s.lying && s.happy <= 0.7) s.bliss = Math.max(0, s.bliss - dt * 0.5);

      // '끙…'이 이어진 시간을 재다가 성질냄. 성질을 내고 나면 조금 풀림
      s.grumpT = !s.held && s.annoyed > 0.6 ? s.grumpT + dt : Math.max(0, s.grumpT - dt * 2);
      if (s.tantrum > 0) {
        s.tantrum = Math.max(0, s.tantrum - dt);
        if (s.tantrum === 0) { s.annoyed = Math.min(s.annoyed, 0.3); s.tantrumCool = TANTRUM_COOLDOWN; }
      } else if (s.tantrumCool > 0) {
        s.tantrumCool -= dt;
      } else if (s.grumpT > GRUMP_TO_TANTRUM) {
        s.tantrum = TANTRUM_TIME; s.grumpT = 0;
        onTantrum?.();
      }
    },
    text() {
      if (s.tantrum > 0) return '캬악!';
      if (s.hanging) return '대롱대롱…';
      if (s.held) return s.annoyed > 0.4 ? '으앗, 늘어나요!' : '쭈욱…';
      if (s.annoyed > 0.6) return '끙…';
      if (s.lying) return '녹아내려요…';
      if (s.happy > 0.7) return '너무 좋아요…';
      if (s.happy > 0.35) return '기분 좋아요';
      return s.petting ? '쓰담쓰담' : '킁킁…';
    },
  };
}
