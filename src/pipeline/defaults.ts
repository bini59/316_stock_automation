/**
 * 기본 파이프라인 구성. 문서 권장 기본값으로 전체 전략 스택을 조립한다.
 * CLI·테스트가 한 줄로 백테스트를 돌릴 수 있게 한다.
 */
import type { AllocationConfig } from "../types/allocation";
import type { AggressivenessConfig } from "../types/sentiment";
import { Broker, usBrokerConfig } from "../engine/broker";
import { RuleBasedRegimeClassifier } from "../regime";
import { defaultStrategyPool } from "../strategies";
import type { RunBacktestConfig } from "./runBacktest";

export const DEFAULT_ALLOCATION_CFG: AllocationConfig = {
  minActivation: 0.05,
  maxWeightPerSymbol: 0.15,
  maxWeightPerFamily: 0.5,
  method: "activation",
};

/** AI 없이 완결되는 1급 모드(useSentiment:false)가 기본 */
export const DEFAULT_AGGRESSIVENESS_CFG: AggressivenessConfig = {
  targetVol: 0.12,
  maxExposure: 1.0,
  useSentiment: false,
  sentimentMaxBoost: 0.15,
  sentimentMaxCut: 0.3,
  freshnessMs: 1000 * 60 * 60 * 24 * 2,
  minConfidence: 0.2,
};

export function defaultBacktestConfig(
  overrides: Partial<RunBacktestConfig> = {},
): RunBacktestConfig {
  return {
    classifier: new RuleBasedRegimeClassifier(),
    strategies: defaultStrategyPool(),
    allocationCfg: DEFAULT_ALLOCATION_CFG,
    aggressivenessCfg: DEFAULT_AGGRESSIVENESS_CFG,
    broker: new Broker(usBrokerConfig()),
    initialCapital: 100_000,
    rebalanceEvery: 5,
    ...overrides,
  };
}
