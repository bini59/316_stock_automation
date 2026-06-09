/**
 * 메타 레이어 자본 배분 계약 (docs/strategy/meta-allocation.md).
 *
 * 메타는 상대 비중(Σ ≤ 1)만 만든다. 전체 크기는 적극도(sentiment)가 곱한다.
 * 핵심은 상관 중복 베팅 제거. strategyReturns 없으면 v1(활성도+패밀리)로 폴백.
 */
import type { StrategyProposal } from "./strategy";

export interface AllocationConfig {
  /** 이하 전략 무시 (예: 0.05) */
  minActivation: number;
  /** 종목 집중 상한 (예: 0.15) */
  maxWeightPerSymbol: number;
  /** 패밀리 예산 상한 (예: 0.50) */
  maxWeightPerFamily: number;
  /** 기본 "activation"(v1) */
  method: "activation" | "riskparity" | "hrp";
  /** v2 상관 추정 윈도우 (거래일) */
  correlationLookback?: number;
}

export interface AllocationInput {
  proposals: readonly StrategyProposal[];
  /** v2 전용: 전략별 trailing 수익률 (상관 추정). 없으면 v1 패밀리 휴리스틱 */
  strategyReturns?: Readonly<Record<string, readonly number[]>>;
}

export interface MetaAllocation {
  /** 최종 종목 상대비중, Σ ≤ 1 */
  weights: Readonly<Record<string, number>>;
  /** 전략별 배분 (설명·로깅) */
  strategyAlloc: Readonly<Record<string, number>>;
  /** "family trend capped" 등 */
  reasons: string[];
}

/**
 * 메타 배분 순수 함수 시그니처. 구현은 src/meta/allocate.ts.
 * strategyReturns가 없으면 자동으로 v1로 폴백.
 */
export type Allocate = (input: AllocationInput, cfg: AllocationConfig) => MetaAllocation;
