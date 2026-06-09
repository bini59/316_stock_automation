/**
 * 현금 패밀리 (TODO 4.2.5, docs/strategy/strategy-pool.md 5.4).
 *
 * All-cash: weights = {} (전량 현금). 자본보존 최우선.
 * affinity: { crisis: 1.0 } → crisis 멤버십이 점화되면 활성도가 점화되고,
 * 비중이 비어 있으므로 메타가 합칠 때 자연스럽게 현금화에 기여한다.
 *
 * ★ 무상태·순수: 항상 {} 반환(입력 무관). look-ahead 불가능(데이터 미참조).
 */
import type {
  RegimeStrategy,
  UniverseHistory,
} from "../types/strategy";
import type { RegimeLabel, RegimeState } from "../types/regime";

const CASH_AFFINITY: Readonly<Partial<Record<RegimeLabel, number>>> = {
  crisis: 1.0,
};

/** 전량 현금 전략. weights는 항상 빈 객체. */
export class AllCash implements RegimeStrategy {
  readonly name = "cash-all";
  readonly family = "cash" as const;
  readonly regimeAffinity = CASH_AFFINITY;
  readonly params: Readonly<Record<string, number>> = {};

  propose(_universe: UniverseHistory, _regime: RegimeState): Record<string, number> {
    return {};
  }
}

/** 기본 현금 전략 묶음. */
export function cashStrategies(): RegimeStrategy[] {
  return [new AllCash()];
}
