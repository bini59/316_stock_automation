/**
 * 합격 게이트 (docs/strategy/validation.md 합격 기준).
 *
 * 전략 후보가 통과해야 다음 관문으로 넘어간다. 실패 사유를 문자열로 기록.
 *
 * 다중검정 보정(절대 원칙·validation.md 3번): 전략·파라미터를 많이 시도할수록
 * 그중 일부는 운으로 좋아 보인다. triesIndex가 클수록 minSharpe 기준을
 * 더 엄격히 적용해 "운으로 통과"를 거른다.
 */
import type { Metrics } from "../types/result";
import type { GateCriteria, GateResult } from "../types/gate";

export function evaluateGate(m: Metrics, c: GateCriteria): GateResult {
  const reasons: string[] = [];
  if (m.sharpe < c.minSharpe) {
    reasons.push(`Sharpe ${m.sharpe.toFixed(2)} < ${c.minSharpe}`);
  }
  if (m.maxDrawdown > c.maxDrawdown) {
    reasons.push(`MDD ${m.maxDrawdown.toFixed(2)} > ${c.maxDrawdown}`);
  }
  if (m.tradeCount < c.minTradeCount) {
    reasons.push(`표본 부족 (${m.tradeCount} < ${c.minTradeCount})`);
  }
  return { passed: reasons.length === 0, reasons };
}

/**
 * 다중검정 보정: 시도 횟수가 2배 늘 때마다 minSharpe를 penaltyPerDoubling만큼
 * 상향한다. triesIndex<=1이면 보정 없음.
 *
 * adjMinSharpe = minSharpe + penaltyPerDoubling × log2(triesIndex)
 */
export function adjustCriteriaForTries(
  c: GateCriteria,
  triesIndex: number,
  penaltyPerDoubling = 0.1,
): GateCriteria {
  const tries = Math.max(1, Math.floor(triesIndex));
  const bump = penaltyPerDoubling * Math.log2(tries);
  return { ...c, minSharpe: c.minSharpe + bump };
}

/**
 * 다중검정 보정을 적용한 게이트 평가. 호출부가 triesIndex를 넘기면
 * 기준이 자동으로 엄격해진다.
 */
export function evaluateGateWithTries(
  m: Metrics,
  c: GateCriteria,
  triesIndex: number,
  penaltyPerDoubling = 0.1,
): GateResult {
  return evaluateGate(m, adjustCriteriaForTries(c, triesIndex, penaltyPerDoubling));
}
