/**
 * 엔진 ↔ 대시보드의 유일한 접점 산출물 (docs/coding/dashboards.md 2절).
 *
 * 대시보드는 이 shape를 타입으로만 import해 읽는다(재구현 금지).
 * BacktestRun → artifacts/backtests/{id}.json
 * LiveSnapshot / ControlFlags → artifacts/live/
 */
import type { BacktestResult } from "./result";
import type { GateResult } from "./gate";
import type { AccountState } from "./account";
import type { RegimeState, RegimeLabel } from "./regime";
import type { Order } from "./order";
import type { LiveMode } from "./broker-port";

/** 시점별 국면·적극도 (대시보드 국면 타임라인 띠용) */
export interface RegimeTimelinePoint {
  timestamp: number;
  membership: Readonly<Record<RegimeLabel, number>>;
  label: RegimeLabel;
  aggressiveness: number;
}

export interface BacktestRun {
  id: string;
  createdAt: number;
  /** 재현에 필요한 전부 (look-ahead·과최적화 추적용) */
  params: Readonly<Record<string, number>>;
  universe: readonly string[];
  dateRange: { from: number; to: number };
  /** in/out-of-sample 경계 */
  split: { inSampleEnd: number };
  /** equityCurve, trades, metrics */
  result: BacktestResult;
  /** out-of-sample 구간 별도 결과 */
  oosResult?: BacktestResult;
  /** 합격/불합격 + 사유 */
  gate: GateResult;
  /** 이 전략에 대해 몇 번째 시도인지 (다중검정) */
  triesIndex: number;
  /** 리밸런스 시점별 국면·적극도 (대시보드 국면 타임라인 오버레이용, 선택) */
  regimePath?: readonly RegimeTimelinePoint[];
}

export interface LiveSnapshot {
  asOf: number;
  mode: LiveMode;
  /** 현금·보유·NAV */
  account: AccountState;
  /** 국면 membership·label */
  regime: RegimeState;
  aggressiveness: number;
  targetWeights: Readonly<Record<string, number>>;
  /** 미체결 */
  openOrders: readonly Order[];
  /** 최근 사이클 의사결정 로그 */
  recentDecisions: readonly string[];
  pnl: { day: number; total: number };
}

/** 웹이 쓰는 유일한 데이터. 엔진이 폴링해서 읽고 따른다. */
export interface ControlFlags {
  /** true → 즉시 DRY_RUN 강등 */
  killSwitch: boolean;
  paused: boolean;
  requestedMode: LiveMode;
  updatedAt: number;
  updatedBy: string;
}
