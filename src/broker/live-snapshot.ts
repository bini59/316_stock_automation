/**
 * LiveSnapshot 산출 (execution-and-data.md, dashboards.md 2절).
 *
 * 실거래 엔진이 매 사이클 artifacts/live/ 에 떨구는 현재 상태. 대시보드는 이
 * shape를 타입으로만 읽는다(엔진↔웹의 유일한 접점). RegimeState는 타입만
 * import — 전략 구현에 의존하지 않는다(레이어 결합 최소화).
 *
 * 원자적 쓰기: tmp 파일에 쓰고 rename해 부분 기록·손상(폴링 측 fail-safe 트리거)을 막는다.
 */
import { mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LiveSnapshot } from "../types/artifact";
import type { LiveMode } from "../types/broker-port";
import type { AccountState } from "../types/account";
import type { RegimeState } from "../types/regime";
import type { Order } from "../types/order";

export interface BuildSnapshotInput {
  readonly asOf: number;
  readonly mode: LiveMode;
  readonly account: AccountState;
  readonly regime: RegimeState;
  readonly aggressiveness: number;
  readonly targetWeights: Readonly<Record<string, number>>;
  readonly openOrders: readonly Order[];
  readonly recentDecisions: readonly string[];
  readonly pnl: { readonly day: number; readonly total: number };
}

/** 입력을 LiveSnapshot으로 정규화(불변 복사). */
export function buildLiveSnapshot(input: BuildSnapshotInput): LiveSnapshot {
  return {
    asOf: input.asOf,
    mode: input.mode,
    account: input.account,
    regime: input.regime,
    aggressiveness: input.aggressiveness,
    targetWeights: { ...input.targetWeights },
    openOrders: [...input.openOrders],
    recentDecisions: [...input.recentDecisions],
    pnl: { day: input.pnl.day, total: input.pnl.total },
  };
}

export const DEFAULT_SNAPSHOT_PATH = "artifacts/live/snapshot.json";

/**
 * LiveSnapshot을 원자적으로 기록한다. 디렉터리는 필요 시 생성.
 * 실패는 호출자에게 전파(조용히 삼키지 않음) — 관측 표면이므로 매매는 안 막힌다.
 */
export async function writeLiveSnapshot(
  snapshot: LiveSnapshot,
  path: string = DEFAULT_SNAPSHOT_PATH,
): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    const tmp = join(dirname(path), `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
    await writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf-8");
    await rename(tmp, path);
  } catch (error) {
    throw new Error(
      `LiveSnapshot 기록 실패(${path}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
