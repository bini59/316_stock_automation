/**
 * in-sample 파라미터 탐색 → OOS 시험 (엔진 모듈, 검증 규율 준수).
 *
 * ★ 절대 규율(validation.md):
 *  - 파라미터는 in-sample(앞 ratio)에서만 고른다. OOS는 선택 후 "한 번만" 시험.
 *  - 다중검정: 시도한 조합 수를 triesIndex로 게이트에 반영(엄격화).
 *  - 과최적화 점검: in-sample vs OOS 샤프 격차를 함께 보고.
 *
 * 웹은 이 로직을 갖지 않는다 — 헤드리스 엔진(여기)을 트리거하고 결과만 읽는다.
 */
import type { Dataset } from "../data/loader";
import type { AllocationConfig } from "../types/allocation";
import type { AggressivenessConfig } from "../types/sentiment";
import type { GateCriteria, GateResult } from "../types/gate";
import type { Metrics } from "../types/result";
import { Broker, usBrokerConfig } from "../engine/broker";
import { backtestPortfolio } from "../engine/backtester";
import { maxDrawdown } from "../validation/metrics";
import { evaluateGateWithTries } from "../validation/gates";
import { runBacktest, runBacktestWithSplit, type RunBacktestConfig } from "./runBacktest";
import { defaultBacktestConfig } from "./defaults";

export interface TuneParams {
  targetVol: number;
  maxWeightPerFamily: number;
  maxWeightPerSymbol: number;
  rebalanceEvery: number;
}

export interface TuneGrid {
  targetVol: number[];
  maxWeightPerFamily: number[];
  maxWeightPerSymbol: number[];
  rebalanceEvery: number[];
}

export const DEFAULT_TUNE_GRID: TuneGrid = {
  targetVol: [0.12, 0.18, 0.25],
  maxWeightPerFamily: [0.5, 0.8],
  maxWeightPerSymbol: [0.15, 0.3],
  rebalanceEvery: [5, 20],
};

export interface TuneConfig {
  classifier: RunBacktestConfig["classifier"];
  strategies: RunBacktestConfig["strategies"];
  initialCapital: number;
  grid: TuneGrid;
  /** in-sample 비율 (앞 ratio로 탐색, 뒤는 OOS) */
  ratio: number;
  gateCriteria: GateCriteria;
}

export interface TuneResult {
  best: TuneParams;
  triesIndex: number;
  ratio: number;
  inSampleEnd: number;
  /** 선택 파라미터의 구간별 지표 */
  tuned: { full: Metrics; inSample: Metrics; oos: Metrics };
  /** 기본 설정 대비 */
  baseline: { full: Metrics; inSample: Metrics; oos: Metrics };
  /** SPY 매수후보유 (벤치마크) */
  buyHold: { totalReturn: number; sharpe: number; maxDrawdown: number };
  /** 다중검정 보정 게이트(OOS 기준) */
  gate: GateResult;
  /** 과최적화 격차 = in-sample 샤프 − OOS 샤프 */
  overfitGap: number;
}

function paramsToConfig(
  p: TuneParams,
  base: Pick<TuneConfig, "classifier" | "strategies" | "initialCapital">,
): RunBacktestConfig {
  const allocationCfg: AllocationConfig = {
    minActivation: 0.05,
    maxWeightPerSymbol: p.maxWeightPerSymbol,
    maxWeightPerFamily: p.maxWeightPerFamily,
    method: "activation",
  };
  const aggressivenessCfg: AggressivenessConfig = {
    targetVol: p.targetVol,
    maxExposure: 1.0,
    useSentiment: false,
    sentimentMaxBoost: 0.15,
    sentimentMaxCut: 0.3,
    freshnessMs: 1000 * 60 * 60 * 24 * 2,
    minConfidence: 0.2,
  };
  return defaultBacktestConfig({
    classifier: base.classifier,
    strategies: base.strategies,
    allocationCfg,
    aggressivenessCfg,
    rebalanceEvery: p.rebalanceEvery,
    initialCapital: base.initialCapital,
    broker: new Broker(usBrokerConfig()),
  });
}

/** 앞 fraction 비율로 시간순 절단(in-sample 구간) */
function truncate(dataset: Dataset, fraction: number): Dataset {
  const n = dataset.benchmark.length;
  const k = Math.max(2, Math.floor(n * fraction));
  const cut = <T,>(a: readonly T[]) => a.slice(0, k);
  const universe: Record<string, Dataset["benchmark"]> = {};
  for (const [s, v] of Object.entries(dataset.universe)) universe[s] = cut(v);
  const macro: Dataset["macro"] = {};
  if (dataset.macro.vix) macro.vix = cut(dataset.macro.vix);
  if (dataset.macro.vix3m) macro.vix3m = cut(dataset.macro.vix3m);
  return { benchmark: cut(dataset.benchmark), universe, macro };
}

function enumerate(grid: TuneGrid): TuneParams[] {
  const out: TuneParams[] = [];
  for (const targetVol of grid.targetVol)
    for (const maxWeightPerFamily of grid.maxWeightPerFamily)
      for (const maxWeightPerSymbol of grid.maxWeightPerSymbol)
        for (const rebalanceEvery of grid.rebalanceEvery)
          out.push({ targetVol, maxWeightPerFamily, maxWeightPerSymbol, rebalanceEvery });
  return out;
}

/**
 * 튜닝 실행. in-sample에서만 그리드 탐색 → 선택 후 OOS 평가.
 * 순수 계산(파일 IO 없음). 결과 객체를 호출자가 artifact로 저장.
 */
export function tune(dataset: Dataset, cfg: TuneConfig): TuneResult {
  const base = {
    classifier: cfg.classifier,
    strategies: cfg.strategies,
    initialCapital: cfg.initialCapital,
  };
  const inSample = truncate(dataset, cfg.ratio);
  const combos = enumerate(cfg.grid);

  // 1) in-sample 그리드 탐색 — OOS는 절대 보지 않는다
  let best: { p: TuneParams; sharpe: number; ret: number } | null = null;
  for (const p of combos) {
    const m = runBacktest(inSample, paramsToConfig(p, base)).result.metrics;
    if (!best || m.sharpe > best.sharpe || (m.sharpe === best.sharpe && m.totalReturn > best.ret)) {
      best = { p, sharpe: m.sharpe, ret: m.totalReturn };
    }
  }
  if (!best) throw new Error("tune: 빈 그리드");
  const triesIndex = combos.length;

  // 2) 선택 파라미터를 전체 기간에 적용 → OOS 여기서 처음 평가
  const tunedSplit = runBacktestWithSplit(dataset, paramsToConfig(best.p, base), cfg.ratio);
  const baseSplit = runBacktestWithSplit(dataset, defaultBacktestConfig({ ...base }), cfg.ratio);

  // 3) SPY 매수후보유
  const bh = backtestPortfolio({
    universe: { SPY: dataset.benchmark },
    broker: new Broker(usBrokerConfig()),
    initialCapital: cfg.initialCapital,
    rebalanceEvery: 20,
    targetWeights: () => ({ SPY: 1 }),
  });

  const gate = evaluateGateWithTries(tunedSplit.oosResult.metrics, cfg.gateCriteria, triesIndex);

  return {
    best: best.p,
    triesIndex,
    ratio: cfg.ratio,
    inSampleEnd: tunedSplit.inSampleEnd,
    tuned: {
      full: tunedSplit.result.metrics,
      inSample: tunedSplit.inSampleResult.metrics,
      oos: tunedSplit.oosResult.metrics,
    },
    baseline: {
      full: baseSplit.result.metrics,
      inSample: baseSplit.inSampleResult.metrics,
      oos: baseSplit.oosResult.metrics,
    },
    buyHold: {
      totalReturn: bh.metrics.totalReturn,
      sharpe: bh.metrics.sharpe,
      maxDrawdown: maxDrawdown(bh.equityCurve),
    },
    gate,
    overfitGap: tunedSplit.inSampleResult.metrics.sharpe - tunedSplit.oosResult.metrics.sharpe,
  };
}
