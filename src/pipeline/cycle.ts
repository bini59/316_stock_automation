/**
 * 한 사이클 오케스트레이터 (TODO 5.1, meta-allocation.md 7절 계약 체인).
 *
 *   classify(history,ctx) → runPool(strategies,universe,regime)
 *     → allocate({proposals},cfg) → computeAggressiveness(risk,cfg,sentiment?)
 *     → finalGross[sym] = weights[sym] × aggressiveness
 *
 * 각 화살표는 types/의 타입 계약 하나. 레이어 구현을 갈아끼워도 체인은 안 깨진다.
 * ★ look-ahead: 입력 benchmark/universe/macro는 모두 "현재 시점까지" 슬라이스여야
 *   한다(호출자가 보장). 이 함수는 잘라주지 않고 받은 그대로 각 레이어에 넘긴다.
 */
import type { PriceSeries } from "../types/market";
import type { UniverseHistory, StrategyProposal, RegimeStrategy } from "../types/strategy";
import type { RegimeClassifier, RegimeState, MacroContext } from "../types/regime";
import type { AllocationConfig, MetaAllocation } from "../types/allocation";
import type {
  AggressivenessConfig,
  AggressivenessResult,
  SentimentSignal,
  RiskInputs,
} from "../types/sentiment";
import { runPool } from "../strategies";
import { allocate } from "../meta";
import { computeAggressiveness } from "../sentiment";
import { realizedVol, closesOf } from "../indicators";

export interface CycleInput {
  classifier: RegimeClassifier;
  strategies: readonly RegimeStrategy[];
  /** 국면 판정 기준 지수, "현재까지" */
  benchmark: PriceSeries;
  /** 운용 유니버스, "현재까지" (벤치마크와 동일 타임라인 정렬 가정) */
  universe: UniverseHistory;
  /** 보조 시계열(vix/vix3m), "현재까지" */
  macro?: MacroContext;
  allocationCfg: AllocationConfig;
  aggressivenessCfg: AggressivenessConfig;
  /** 현재 포트폴리오 낙폭 0..1 (백테스터/실거래가 공급). 기본 0 */
  drawdown?: number;
  /** AI 감성(선택). 없으면 베이스라인만 */
  sentiment?: SentimentSignal;
  /** 의사결정 시점(epoch ms). 감성 신선도·look-ahead 판단용 */
  now?: number;
  /** 실현변동성 윈도우(거래일). 기본 20 */
  realizedVolWindow?: number;
}

export interface CycleOutput {
  regime: RegimeState;
  proposals: StrategyProposal[];
  allocation: MetaAllocation;
  aggressiveness: AggressivenessResult;
  /** 최종 목표 gross 비중 = allocation.weights × aggressiveness */
  targetWeights: Record<string, number>;
  risk: RiskInputs;
}

/**
 * 전략 스택 한 사이클 실행. 순수 함수(같은 입력 → 같은 출력).
 */
export function runCycle(input: CycleInput): CycleOutput {
  const {
    classifier,
    strategies,
    benchmark,
    universe,
    macro,
    allocationCfg,
    aggressivenessCfg,
  } = input;
  const drawdown = input.drawdown ?? 0;
  const volWindow = input.realizedVolWindow ?? 20;

  // ① 국면 분류
  const regime = classifier.classify(benchmark, macro);

  // ② 전략 풀
  const proposals = runPool(strategies, universe, regime);

  // ③ 메타 배분 (상대 비중, Σ ≤ 1)
  const allocation = allocate({ proposals }, allocationCfg);

  // ④ 적극도 (전체 gross 스케일)
  const rv = realizedVol(closesOf(benchmark), volWindow) ?? 0;
  const risk: RiskInputs = { realizedVol: rv, drawdown, regime };
  const aggressiveness = computeAggressiveness(
    risk,
    aggressivenessCfg,
    input.sentiment,
    input.now,
  );

  // finalGross[sym] = weights[sym] × aggressiveness
  const targetWeights: Record<string, number> = {};
  for (const [sym, w] of Object.entries(allocation.weights)) {
    const g = w * aggressiveness.aggressiveness;
    if (g > 0) targetWeights[sym] = g;
  }

  return { regime, proposals, allocation, aggressiveness, targetWeights, risk };
}
