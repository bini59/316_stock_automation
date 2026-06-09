/**
 * BacktestRun artifact 산출 (TODO 5.4).
 *
 * shape은 dashboards.md의 BacktestRun(types/artifact.ts)과 정확히 일치 — 대시보드가
 * 재구현 없이 읽는다. params/universe/dateRange/split/result/oosResult/gate/triesIndex.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BacktestRun } from "../types/artifact";
import type { GateCriteria } from "../types/gate";
import { evaluateGateWithTries } from "../validation/gates";
import type { Dataset } from "../data/loader";
import { runBacktestWithSplit, type RunBacktestConfig } from "./runBacktest";

export interface BuildBacktestRunOptions {
  id: string;
  createdAt: number;
  /** 재현용 파라미터 기록(look-ahead·과최적화 추적) */
  params: Readonly<Record<string, number>>;
  gateCriteria: GateCriteria;
  /** 이 전략에 대한 몇 번째 시도(다중검정) */
  triesIndex: number;
  /** in/out-of-sample 비율 */
  ratio?: number;
}

/**
 * 백테스트를 실행하고 BacktestRun artifact 객체를 만든다(파일 쓰기는 writeBacktestRun).
 * 게이트는 OOS 지표로 평가(있으면) — in-sample 성과는 당연하므로 OOS로 합격 판정.
 * triesIndex로 다중검정 보정 적용.
 */
export function buildBacktestRun(
  dataset: Dataset,
  cfg: RunBacktestConfig,
  opts: BuildBacktestRunOptions,
): BacktestRun {
  const ratio = opts.ratio ?? 0.75;
  const split = runBacktestWithSplit(dataset, cfg, ratio);
  const timeline = split.timeline;

  const gateMetrics = split.oosResult.metrics;
  const gate = evaluateGateWithTries(gateMetrics, opts.gateCriteria, opts.triesIndex);

  return {
    id: opts.id,
    createdAt: opts.createdAt,
    params: opts.params,
    universe: Object.keys(dataset.universe),
    dateRange: { from: timeline[0] ?? 0, to: timeline[timeline.length - 1] ?? 0 },
    split: { inSampleEnd: split.inSampleEnd },
    result: split.result,
    oosResult: split.oosResult,
    gate,
    triesIndex: opts.triesIndex,
    regimePath: split.regimePath,
  };
}

/** artifacts/backtests/{id}.json 에 기록(원자적 쓰기). */
export async function writeBacktestRun(
  run: BacktestRun,
  dir = "artifacts/backtests",
): Promise<string> {
  return atomicWriteJson(path.join(dir, `${run.id}.json`), run, dir);
}

/** 튜닝 결과 artifact — 웹이 읽어 비교 테이블을 그린다. */
export interface TuningArtifact {
  id: string;
  createdAt: number;
  universe: readonly string[];
  dateRange: { from: number; to: number };
  /** 최적 BacktestRun id(상세 차트는 이 run을 참조) */
  bestRunId: string;
  result: import("./tune").TuneResult;
}

/** artifacts/tuning/{id}.json 에 기록(원자적). */
export async function writeTuningResult(
  artifact: TuningArtifact,
  dir = "artifacts/tuning",
): Promise<string> {
  return atomicWriteJson(path.join(dir, `${artifact.id}.json`), artifact, dir);
}

async function atomicWriteJson(file: string, data: unknown, dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(tmp, file);
  return file;
}
