/**
 * 헤드리스 엔진 CLI 엔트리포인트 (TODO 5.5).
 *
 * run-backtest --source yahoo --universe XLK,XLF,... --from 2015-01-01 --to 2024-12-31
 *              [--benchmark SPY] [--vix ^VIX] [--vix3m ^VIX3M] [--id run1]
 *              [--rebalance 5] [--capital 100000] [--ratio 0.75] [--tries 1]
 * run-backtest --source csv --data-dir ./data ...   (CSV: {symbol}.csv)
 * tune --source yahoo --universe ... --from ... --to ... [--id t1] [--ratio 0.7]
 *
 * --source 기본 yahoo(키 불필요). 결과: artifacts/backtests/{id}.json, artifacts/tuning/{id}.json.
 */
import {
  CsvBarLoader,
  YahooBarLoader,
  loadDataset,
  SECTOR_ETF_UNIVERSE,
  type BarLoader,
  type Dataset,
} from "./data";
import {
  buildBacktestRun,
  writeBacktestRun,
  writeTuningResult,
  defaultBacktestConfig,
  tune,
  DEFAULT_TUNE_GRID,
} from "./pipeline";
import { RuleBasedRegimeClassifier } from "./regime";
import { defaultStrategyPool } from "./strategies";
import type { GateCriteria } from "./types/gate";

const DEFAULT_GATE: GateCriteria = { minSharpe: 0.5, maxDrawdown: 0.25, minTradeCount: 20 };

/** ISO/epoch 문자열 → epoch ms */
function parseDate(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  if (/^\d+$/.test(raw)) return raw.length <= 10 ? Number(raw) * 1000 : Number(raw);
  const t = Date.parse(raw);
  return Number.isNaN(t) ? fallback : t;
}

/** 공통 데이터셋 빌더: --source yahoo(키 불필요, 기본) | csv */
async function buildDataset(flags: Record<string, string>): Promise<{
  dataset: Dataset;
  benchmark: string;
  universe: string[];
}> {
  const benchmark = flags.benchmark ?? "SPY";
  const universe = flags.universe
    ? flags.universe.split(",").map((s) => s.trim()).filter(Boolean)
    : [...SECTOR_ETF_UNIVERSE];
  const source = (flags.source ?? "yahoo").toLowerCase();

  let loader: BarLoader;
  if (source === "csv") {
    const dataDir = flags.dataDir ?? flags["data-dir"];
    if (!dataDir) throw new Error("--source csv 에는 --data-dir 필요");
    loader = new CsvBarLoader(dataDir);
  } else {
    const from = parseDate(flags.from, Date.UTC(2015, 0, 1));
    const to = parseDate(flags.to, Date.UTC(2025, 0, 1));
    loader = new YahooBarLoader({ from, to });
  }

  const dataset = await loadDataset(loader, {
    benchmark,
    universe,
    ...(flags.vix ? { vix: flags.vix } : {}),
    ...(flags.vix3m ? { vix3m: flags.vix3m } : {}),
  });
  return { dataset, benchmark, universe };
}

export interface CliArgs {
  command: string;
  flags: Record<string, string>;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const command = argv[0] ?? "";
  const flags: Record<string, string> = {};
  for (let i = 1; i < argv.length; i++) {
    const tok = argv[i];
    if (tok?.startsWith("--")) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return { command, flags };
}

export async function runBacktestCommand(flags: Record<string, string>): Promise<string> {
  const { dataset, benchmark, universe } = await buildDataset(flags);

  const cfg = defaultBacktestConfig({
    initialCapital: flags.capital ? Number(flags.capital) : 100_000,
    rebalanceEvery: flags.rebalance ? Number(flags.rebalance) : 5,
  });

  const id = flags.id ?? `run-${benchmark}-${universe.length}sym`;
  const run = buildBacktestRun(dataset, cfg, {
    id,
    createdAt: Number(flags.now ?? dataset.benchmark[dataset.benchmark.length - 1]?.timestamp ?? 0),
    params: {
      rebalanceEvery: cfg.rebalanceEvery ?? 5,
      initialCapital: cfg.initialCapital,
      targetVol: cfg.aggressivenessCfg.targetVol,
    },
    gateCriteria: DEFAULT_GATE,
    triesIndex: flags.tries ? Number(flags.tries) : 1,
    ratio: flags.ratio ? Number(flags.ratio) : 0.75,
  });

  const file = await writeBacktestRun(run);
  const m = run.result.metrics;
  const oos = run.oosResult?.metrics;
  process.stdout.write(
    [
      `백테스트 완료: ${file}`,
      `  전체: return ${(m.totalReturn * 100).toFixed(1)}% sharpe ${m.sharpe.toFixed(2)} MDD ${(m.maxDrawdown * 100).toFixed(1)}% trades ${m.tradeCount}`,
      oos
        ? `  OOS:  return ${(oos.totalReturn * 100).toFixed(1)}% sharpe ${oos.sharpe.toFixed(2)} MDD ${(oos.maxDrawdown * 100).toFixed(1)}% trades ${oos.tradeCount}`
        : "",
      `  게이트: ${run.gate.passed ? "합격" : "불합격"} ${run.gate.reasons.join("; ")}`,
      `  다중검정 시도: ${run.triesIndex}`,
    ]
      .filter(Boolean)
      .join("\n") + "\n",
  );
  return file;
}

export async function tuneCommand(flags: Record<string, string>): Promise<{ tuning: string; bestRun: string }> {
  const { dataset, benchmark, universe } = await buildDataset(flags);
  const ratio = flags.ratio ? Number(flags.ratio) : 0.7;

  const result = tune(dataset, {
    classifier: new RuleBasedRegimeClassifier(),
    strategies: defaultStrategyPool(),
    initialCapital: flags.capital ? Number(flags.capital) : 100_000,
    grid: DEFAULT_TUNE_GRID,
    ratio,
    gateCriteria: DEFAULT_GATE,
  });

  const id = flags.id ?? `tune-${benchmark}-${universe.length}sym`;
  const bestRunId = `${id}-best`;
  const createdAt = Number(
    flags.now ?? dataset.benchmark[dataset.benchmark.length - 1]?.timestamp ?? 0,
  );

  // 최적 파라미터로 BacktestRun 산출(상세 차트용) + 튜닝 요약 artifact
  const bestRun = buildBacktestRun(
    dataset,
    defaultBacktestConfig({
      allocationCfg: {
        minActivation: 0.05,
        maxWeightPerSymbol: result.best.maxWeightPerSymbol,
        maxWeightPerFamily: result.best.maxWeightPerFamily,
        method: "activation",
      },
      aggressivenessCfg: {
        ...defaultBacktestConfig().aggressivenessCfg,
        targetVol: result.best.targetVol,
      },
      rebalanceEvery: result.best.rebalanceEvery,
    }),
    {
      id: bestRunId,
      createdAt,
      params: { ...result.best },
      gateCriteria: DEFAULT_GATE,
      triesIndex: result.triesIndex,
      ratio,
    },
  );
  const bestRunFile = await writeBacktestRun(bestRun);
  const tuningFile = await writeTuningResult({
    id,
    createdAt,
    universe,
    dateRange: bestRun.dateRange,
    bestRunId,
    result,
  });

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  process.stdout.write(
    [
      `튜닝 완료: ${tuningFile}`,
      `  최적 파라미터(in-sample): ${JSON.stringify(result.best)}`,
      `  다중검정 triesIndex=${result.triesIndex}`,
      `  튜닝   full: ret ${pct(result.tuned.full.totalReturn)} sharpe ${result.tuned.full.sharpe.toFixed(2)} MDD ${pct(result.tuned.full.maxDrawdown)}`,
      `  튜닝   OOS:  ret ${pct(result.tuned.oos.totalReturn)} sharpe ${result.tuned.oos.sharpe.toFixed(2)} MDD ${pct(result.tuned.oos.maxDrawdown)}`,
      `  기본   OOS:  ret ${pct(result.baseline.oos.totalReturn)} sharpe ${result.baseline.oos.sharpe.toFixed(2)}`,
      `  SPY    full: ret ${pct(result.buyHold.totalReturn)} sharpe ${result.buyHold.sharpe.toFixed(2)} MDD ${pct(result.buyHold.maxDrawdown)}`,
      `  OOS 게이트(보정): ${result.gate.passed ? "합격" : "불합격"} ${result.gate.reasons.join("; ")}`,
      `  과최적화 격차(in-OOS 샤프): ${result.overfitGap.toFixed(2)}`,
    ].join("\n") + "\n",
  );
  return { tuning: tuningFile, bestRun: bestRunFile };
}

export async function main(argv: readonly string[]): Promise<void> {
  const { command, flags } = parseArgs(argv);
  switch (command) {
    case "run-backtest":
      await runBacktestCommand(flags);
      break;
    case "tune":
      await tuneCommand(flags);
      break;
    default:
      process.stdout.write(
        [
          "레짐 기반 멀티 전략 자동매매 엔진 (헤드리스)",
          "사용법:",
          "  run-backtest --source yahoo --universe XLK,XLF,... --from 2015-01-01 --to 2024-12-31 [--vix ^VIX] [--id run1]",
          "  run-backtest --source csv --data-dir <dir> ...",
          "  tune --source yahoo --universe ... --from ... --to ... [--id t1] [--ratio 0.7]",
        ].join("\n") + "\n",
      );
  }
}

// 직접 실행 시에만 main 호출(테스트 import 시 부작용 없음). tsx(.ts)·node(.js) 모두 지원.
const invokedDirectly =
  typeof process !== "undefined" && /index\.(ts|js)$/.test(process.argv[1] ?? "");
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`오류: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
