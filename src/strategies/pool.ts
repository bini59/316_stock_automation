/**
 * 전략 풀 라우터 (TODO 4.2.1, docs/strategy/strategy-pool.md 3·4절).
 *
 * 등록된 RegimeStrategy들을 돌려 StrategyProposal[]을 만든다.
 * activation = Σ_label membership[label] × regimeAffinity[label] (소프트 블렌딩).
 *
 * ★ 하드 스위치 없음: 활성도가 부드럽게 변해 whipsaw를 죽인다.
 * ★ look-ahead 무관: propose에 넘기는 universe는 호출자(엔진)가 잘라준 "현재까지".
 *   이 라우터는 universe를 변형하지 않고 그대로 전달한다.
 */
import type {
  RegimeStrategy,
  StrategyProposal,
  UniverseHistory,
} from "../types/strategy";
import type { RegimeLabel, RegimeState } from "../types/regime";
import { capSum } from "./weights";

/** 활성도가 이 값 미만이면 전략을 비활성으로 본다(제안 제외). */
export const ACTIVATION_EPS = 0.05;

/**
 * 활성도 = membership과 regimeAffinity의 내적.
 * membership에 없는 라벨은 0, affinity에 없는 라벨은 0으로 취급.
 */
export function activationOf(
  membership: Readonly<Record<RegimeLabel, number>>,
  affinity: Readonly<Partial<Record<RegimeLabel, number>>>,
): number {
  let acc = 0;
  for (const [label, aff] of Object.entries(affinity)) {
    const m = membership[label as RegimeLabel];
    if (typeof m === "number" && typeof aff === "number") acc += m * aff;
  }
  return acc;
}

/**
 * 전략 풀 실행: 각 전략의 활성도를 계산하고, 활성인 것만 제안을 수집.
 * - activation < EPS → 전략이 propose를 호출하지 않고 제외(거래비용·whipsaw 절약).
 * - weights는 합 ≤ 1로 캡(전략-내 현금 보존). 음수는 제거.
 */
export function runPool(
  strategies: readonly RegimeStrategy[],
  universe: UniverseHistory,
  regime: RegimeState,
): StrategyProposal[] {
  const out: StrategyProposal[] = [];
  for (const s of strategies) {
    const activation = activationOf(regime.membership, s.regimeAffinity);
    if (activation < ACTIVATION_EPS) continue;
    const raw = s.propose(universe, regime);
    const weights = capSum(sanitize(raw), 1);
    out.push({ strategy: s.name, activation, weights, family: s.family });
  }
  return out;
}

/** 음수·비유한·유니버스 밖 비중을 제거(방어적). 0은 버려도 무관하지만 보존. */
function sanitize(weights: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [sym, w] of Object.entries(weights)) {
    if (Number.isFinite(w) && w > 0) out[sym] = w;
  }
  return out;
}
