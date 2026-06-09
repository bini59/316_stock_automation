/**
 * in-sample 파라미터 탐색 → OOS 시험 (검증 규율 준수).
 *
 * ★ 절대 규율(validation.md): 파라미터는 in-sample(앞 ratio)에서만 고른다.
 *   OOS(뒤 구간)는 선택이 끝난 뒤 "한 번만" 시험한다(보는 순간 in-sample이 됨).
 * ★ 다중검정: 시도한 조합 수를 triesIndex로 게이트에 반영(엄격화).
 *
 * 사용: tsx scripts/tune.ts <data-dir>
 */
import { CsvBarLoader, loadDataset, type Dataset } from "../src/data";
import {
  runBacktest,
  runBacktestWithSplit,
  defaultBacktestConfig,
  type RunBacktestConfig,
} from "../src/pipeline";
import { backtestPortfolio } from "../src/engine/backtester";
import { Broker, usBrokerConfig } from "../src/engine/broker";
import { maxDrawdown } from "../src/validation/metrics";
import { evaluateGateWithTries } from "../src/validation/gates";
import type { AllocationConfig } from "../src/types/allocation";
import type { AggressivenessConfig } from "../src/types/sentiment";

const UNIVERSE = ["XLK", "XLF", "XLV", "XLE", "XLI", "XLY", "XLP", "XLU", "XLB"];
const IN_SAMPLE_RATIO = 0.7;

/** 데이터셋을 앞 fraction 비율로 시간순 절단(in-sample 구간) */
function truncate(dataset: Dataset, fraction: number): Dataset {
  const n = dataset.benchmark.length;
  const k = Math.max(2, Math.floor(n * fraction));
  const cut = <T,>(a: readonly T[]) => a.slice(0, k);
  const universe: Record<string, typeof dataset.benchmark> = {};
  for (const [s, v] of Object.entries(dataset.universe)) universe[s] = cut(v);
  const macro: Dataset["macro"] = {};
  if (dataset.macro.vix) macro.vix = cut(dataset.macro.vix);
  if (dataset.macro.vix3m) macro.vix3m = cut(dataset.macro.vix3m);
  return { benchmark: cut(dataset.benchmark), universe, macro };
}

interface Combo {
  targetVol: number;
  maxWeightPerFamily: number;
  maxWeightPerSymbol: number;
  rebalanceEvery: number;
}

function configFor(c: Combo): RunBacktestConfig {
  const allocationCfg: AllocationConfig = {
    minActivation: 0.05,
    maxWeightPerSymbol: c.maxWeightPerSymbol,
    maxWeightPerFamily: c.maxWeightPerFamily,
    method: "activation",
  };
  const aggressivenessCfg: AggressivenessConfig = {
    targetVol: c.targetVol,
    maxExposure: 1.0,
    useSentiment: false,
    sentimentMaxBoost: 0.15,
    sentimentMaxCut: 0.3,
    freshnessMs: 1000 * 60 * 60 * 24 * 2,
    minConfidence: 0.2,
  };
  return defaultBacktestConfig({
    allocationCfg,
    aggressivenessCfg,
    rebalanceEvery: c.rebalanceEvery,
    broker: new Broker(usBrokerConfig()),
  });
}

const GRID = {
  targetVol: [0.12, 0.18, 0.25],
  maxWeightPerFamily: [0.5, 0.8],
  maxWeightPerSymbol: [0.15, 0.3],
  rebalanceEvery: [5, 20],
};

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("data-dir 인자 필요");
  const loader = new CsvBarLoader(dir);
  const dataset = await loadDataset(loader, {
    benchmark: "SPY",
    universe: UNIVERSE,
    vix: "^VIX",
    vix3m: "^VIX3M",
  });

  const inSample = truncate(dataset, IN_SAMPLE_RATIO);

  // 1) in-sample 그리드 탐색 — OOS는 절대 보지 않는다
  const combos: Combo[] = [];
  for (const targetVol of GRID.targetVol)
    for (const maxWeightPerFamily of GRID.maxWeightPerFamily)
      for (const maxWeightPerSymbol of GRID.maxWeightPerSymbol)
        for (const rebalanceEvery of GRID.rebalanceEvery)
          combos.push({ targetVol, maxWeightPerFamily, maxWeightPerSymbol, rebalanceEvery });

  let best: { combo: Combo; sharpe: number; ret: number; mdd: number } | null = null;
  for (const combo of combos) {
    const out = runBacktest(inSample, configFor(combo));
    const m = out.result.metrics;
    // 목적함수: in-sample 샤프(위험 대비 수익). 동률이면 수익 우선.
    if (!best || m.sharpe > best.sharpe || (m.sharpe === best.sharpe && m.totalReturn > best.ret)) {
      best = { combo, sharpe: m.sharpe, ret: m.totalReturn, mdd: m.maxDrawdown };
    }
  }
  if (!best) throw new Error("no combo");

  const triesIndex = combos.length; // 다중검정: 시도한 조합 수

  // 2) 선택된 파라미터를 전체 기간에 적용 → OOS는 여기서 "처음" 평가
  const split = runBacktestWithSplit(dataset, configFor(best.combo), IN_SAMPLE_RATIO);
  const def = runBacktestWithSplit(dataset, defaultBacktestConfig(), IN_SAMPLE_RATIO);

  // 3) SPY 매수후보유 (동일 기간)
  const bh = backtestPortfolio({
    universe: { SPY: dataset.benchmark },
    broker: new Broker(usBrokerConfig()),
    initialCapital: 100_000,
    rebalanceEvery: 20,
    targetWeights: () => ({ SPY: 1 }),
  });
  const bhMdd = maxDrawdown(bh.equityCurve);
  const bhRet = bh.metrics.totalReturn;

  const gateCriteria = { minSharpe: 0.5, maxDrawdown: 0.25, minTradeCount: 20 };
  const gate = evaluateGateWithTries(split.oosResult.metrics, gateCriteria, triesIndex);

  console.log(`\n=== 튜닝 (in-sample 탐색 ${combos.length}조합 → OOS 시험, 다중검정 보정) ===\n`);
  console.log(`최적 파라미터(in-sample 기준): ${JSON.stringify(best.combo)}`);
  console.log(`다중검정 triesIndex=${triesIndex} → 게이트 minSharpe 상향 적용\n`);

  const row = (name: string, r: number, s: number, mdd: number) =>
    `${name.padEnd(22)} 수익 ${pct(r).padStart(8)}  샤프 ${s.toFixed(2).padStart(6)}  MDD ${pct(mdd).padStart(7)}`;

  console.log("── 전체 기간 (2015~2024, 비용 반영) ──");
  console.log(row("SPY buy&hold", bhRet, bh.metrics.sharpe, bhMdd));
  console.log(row("기본 설정", def.result.metrics.totalReturn, def.result.metrics.sharpe, def.result.metrics.maxDrawdown));
  console.log(row("튜닝 설정", split.result.metrics.totalReturn, split.result.metrics.sharpe, split.result.metrics.maxDrawdown));

  console.log("\n── in-sample (앞 70%, 파라미터 선택 구간) ──");
  console.log(row("기본 설정", def.inSampleResult.metrics.totalReturn, def.inSampleResult.metrics.sharpe, def.inSampleResult.metrics.maxDrawdown));
  console.log(row("튜닝 설정", split.inSampleResult.metrics.totalReturn, split.inSampleResult.metrics.sharpe, split.inSampleResult.metrics.maxDrawdown));

  console.log("\n── ★ OOS (뒤 30%, 한 번도 안 본 구간 — 진짜 시험) ──");
  console.log(row("기본 설정", def.oosResult.metrics.totalReturn, def.oosResult.metrics.sharpe, def.oosResult.metrics.maxDrawdown));
  console.log(row("튜닝 설정", split.oosResult.metrics.totalReturn, split.oosResult.metrics.sharpe, split.oosResult.metrics.maxDrawdown));

  console.log(`\nOOS 게이트(다중검정 보정): ${gate.passed ? "합격" : "불합격"} ${gate.reasons.join("; ")}`);
  const isS = split.inSampleResult.metrics.sharpe;
  const oosS = split.oosResult.metrics.sharpe;
  console.log(`과최적화 점검: in-sample 샤프 ${isS.toFixed(2)} vs OOS 샤프 ${oosS.toFixed(2)} (격차 클수록 과최적화 의심)`);
}

main().catch((e) => {
  process.stderr.write(`오류: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
