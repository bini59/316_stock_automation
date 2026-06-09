/**
 * 헤드리스 엔진 CLI 엔트리포인트 (TODO 5.5).
 *
 * 사용법:
 *   run-backtest --data-dir ./data [--benchmark SPY] [--universe XLK,XLF,...]
 *                [--vix ^VIX] [--vix3m ^VIX3M] [--id run1] [--rebalance 5]
 *                [--capital 100000] [--ratio 0.75] [--tries 1]
 *
 * data-dir에는 {symbol}.csv (date,open,high,low,close,volume) 파일이 있어야 한다.
 * API 키 0개로 동작(M7까지). 결과는 artifacts/backtests/{id}.json.
 */
import { CsvBarLoader, loadDataset, SECTOR_ETF_UNIVERSE } from "./data";
import { buildBacktestRun, writeBacktestRun, defaultBacktestConfig } from "./pipeline";
import type { GateCriteria } from "./types/gate";

const DEFAULT_GATE: GateCriteria = { minSharpe: 0.5, maxDrawdown: 0.25, minTradeCount: 20 };

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
  const dataDir = flags.dataDir ?? flags["data-dir"];
  if (!dataDir) throw new Error("run-backtest: --data-dir 필요");

  const benchmark = flags.benchmark ?? "SPY";
  const universe = flags.universe ? flags.universe.split(",").map((s) => s.trim()) : [...SECTOR_ETF_UNIVERSE];
  const loader = new CsvBarLoader(dataDir);

  const dataset = await loadDataset(loader, {
    benchmark,
    universe,
    ...(flags.vix ? { vix: flags.vix } : {}),
    ...(flags.vix3m ? { vix3m: flags.vix3m } : {}),
  });

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

export async function main(argv: readonly string[]): Promise<void> {
  const { command, flags } = parseArgs(argv);
  switch (command) {
    case "run-backtest":
      await runBacktestCommand(flags);
      break;
    default:
      process.stdout.write(
        "레짐 기반 멀티 전략 자동매매 엔진\n사용법: run-backtest --data-dir <dir> [옵션]\n",
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
