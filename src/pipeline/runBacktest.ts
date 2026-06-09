/**
 * 백테스트 러너 (TODO 5.2·5.3). 다중종목 백테스터 + 파이프라인을 시점마다 호출,
 * 리밸런싱 주기에만 체결, 비용 반영. in/out-of-sample 분리 평가.
 *
 * ★ look-ahead: 모든 시계열(벤치마크/유니버스/매크로)을 공통 타임라인으로 정렬한
 *   뒤, 매 시점 i에서 [0..i] 슬라이스만 runCycle에 넘긴다(미래 차단).
 * ★ 비용: backtestPortfolio가 모든 체결을 Broker로 강제 → 비용 0 백테스트 불가.
 */
import type { PriceSeries } from "../types/market";
import type { UniverseHistory, RegimeStrategy } from "../types/strategy";
import type { RegimeClassifier, MacroContext, RegimeLabel } from "../types/regime";
import type { AllocationConfig } from "../types/allocation";
import type { AggressivenessConfig, SentimentSignal } from "../types/sentiment";
import type { BacktestResult } from "../types/result";
import { Broker } from "../engine/broker";
import { backtestPortfolio } from "../engine/backtester";
import { alignUniverse } from "../data/integrity";
import { computeMetrics } from "../validation/metrics";
import { runCycle } from "./cycle";
import type { Dataset } from "../data/loader";

export interface RunBacktestConfig {
  classifier: RegimeClassifier;
  strategies: readonly RegimeStrategy[];
  allocationCfg: AllocationConfig;
  aggressivenessCfg: AggressivenessConfig;
  broker: Broker;
  initialCapital: number;
  /** 리밸런싱 주기(거래일). 기본 5(주간) */
  rebalanceEvery?: number;
  /** 정적 감성 신호(선택). 백테스트에선 보통 미사용(베이스라인) */
  sentiment?: SentimentSignal;
  realizedVolWindow?: number;
  minTradeFraction?: number;
}

export interface RegimePoint {
  timestamp: number;
  membership: Readonly<Record<RegimeLabel, number>>;
  label: RegimeLabel;
  aggressiveness: number;
}

export interface RunBacktestOutput {
  result: BacktestResult;
  /** 리밸런스 시점별 국면·적극도 타임라인(대시보드 국면 띠용) */
  regimePath: RegimePoint[];
  /** 정렬된 공통 타임라인 timestamps */
  timeline: number[];
}

/** 벤치마크·유니버스·매크로를 공통 타임스탬프로 정렬 */
function alignAll(dataset: Dataset): {
  benchmark: PriceSeries;
  universe: UniverseHistory;
  macro: MacroContext;
} {
  const BENCH = "__benchmark__";
  const VIX = "__vix__";
  const VIX3M = "__vix3m__";
  const combined: Record<string, PriceSeries> = { ...dataset.universe, [BENCH]: dataset.benchmark };
  if (dataset.macro.vix) combined[VIX] = dataset.macro.vix;
  if (dataset.macro.vix3m) combined[VIX3M] = dataset.macro.vix3m;

  const aligned = alignUniverse(combined);
  const benchmark = aligned[BENCH] ?? [];
  const macro: MacroContext = {};
  if (aligned[VIX]) macro.vix = aligned[VIX];
  if (aligned[VIX3M]) macro.vix3m = aligned[VIX3M];

  const universe: Record<string, PriceSeries> = {};
  for (const sym of Object.keys(dataset.universe)) {
    if (aligned[sym]) universe[sym] = aligned[sym]!;
  }
  return { benchmark, universe, macro };
}

export function runBacktest(dataset: Dataset, cfg: RunBacktestConfig): RunBacktestOutput {
  const { benchmark, universe, macro } = alignAll(dataset);
  const timeline = benchmark.map((b) => b.timestamp);
  const rebalanceEvery = cfg.rebalanceEvery ?? 5;
  const regimePath: RegimePoint[] = [];

  const result = backtestPortfolio({
    universe,
    broker: cfg.broker,
    initialCapital: cfg.initialCapital,
    rebalanceEvery,
    ...(cfg.minTradeFraction !== undefined ? { minTradeFraction: cfg.minTradeFraction } : {}),
    targetWeights: (histories, i, ctx) => {
      const cycle = runCycle({
        classifier: cfg.classifier,
        strategies: cfg.strategies,
        benchmark: benchmark.slice(0, i + 1),
        universe: histories,
        macro: sliceMacro(macro, i),
        allocationCfg: cfg.allocationCfg,
        aggressivenessCfg: cfg.aggressivenessCfg,
        drawdown: ctx.drawdown,
        ...(cfg.sentiment ? { sentiment: cfg.sentiment } : {}),
        now: timeline[i] ?? i,
        ...(cfg.realizedVolWindow !== undefined
          ? { realizedVolWindow: cfg.realizedVolWindow }
          : {}),
      });
      regimePath.push({
        timestamp: timeline[i] ?? i,
        membership: cycle.regime.membership,
        label: cycle.regime.label,
        aggressiveness: cycle.aggressiveness.aggressiveness,
      });
      return cycle.targetWeights;
    },
  });

  return { result, regimePath, timeline };
}

function sliceMacro(macro: MacroContext, i: number): MacroContext {
  const out: MacroContext = {};
  if (macro.vix) out.vix = macro.vix.slice(0, i + 1);
  if (macro.vix3m) out.vix3m = macro.vix3m.slice(0, i + 1);
  return out;
}

/**
 * in/out-of-sample 분리 평가. 전체를 한 번 walk한 뒤(동일 실행, look-ahead 안전),
 * 경계 timestamp 기준으로 equityCurve·trades를 잘라 OOS 구간 지표를 별도 산출.
 * 튜닝은 in-sample 결과로만(OOS는 시험만).
 */
export interface SplitBacktestOutput extends RunBacktestOutput {
  inSampleResult: BacktestResult;
  oosResult: BacktestResult;
  inSampleEnd: number;
}

export function runBacktestWithSplit(
  dataset: Dataset,
  cfg: RunBacktestConfig,
  ratio = 0.75,
): SplitBacktestOutput {
  const full = runBacktest(dataset, cfg);
  const { timeline, result } = full;
  const n = timeline.length;
  const boundary = Math.min(n - 1, Math.max(1, Math.floor(n * ratio)));
  const inSampleEnd = timeline[boundary - 1] ?? timeline[boundary] ?? 0;

  const inEquity = result.equityCurve.slice(0, boundary);
  const oosEquityRaw = result.equityCurve.slice(boundary - 1); // 경계점 포함해 OOS 수익률 기준점 확보

  const inTrades = result.trades.filter((t) => t.exitTime <= inSampleEnd);
  const oosTrades = result.trades.filter((t) => t.exitTime > inSampleEnd);

  const inSampleResult: BacktestResult = {
    equityCurve: inEquity,
    trades: inTrades,
    metrics: computeMetrics(inEquity, inTrades),
  };
  const oosResult: BacktestResult = {
    equityCurve: oosEquityRaw,
    trades: oosTrades,
    metrics: computeMetrics(oosEquityRaw, oosTrades),
  };

  return { ...full, inSampleResult, oosResult, inSampleEnd };
}
