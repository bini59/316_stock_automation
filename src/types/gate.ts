/**
 * 합격 게이트 계약 (docs/strategy/validation.md).
 *
 * 다중검정 보정: triesIndex가 클수록 기준을 엄격히(구현은 validation/gates.ts).
 */
import type { Metrics } from "./result";

export interface GateCriteria {
  minSharpe: number;
  /** 허용 최대 낙폭 (0..1) */
  maxDrawdown: number;
  /** 표본이 너무 적으면 신뢰 불가 */
  minTradeCount: number;
}

export interface GateResult {
  passed: boolean;
  /** 실패 사유 기록 */
  reasons: string[];
}

/** 게이트 평가 시그니처. 구현은 src/validation/gates.ts */
export type EvaluateGate = (m: Metrics, c: GateCriteria) => GateResult;
