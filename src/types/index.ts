/**
 * 타입 계약 배럴 export. 모든 레이어는 여기(또는 개별 파일)에서만 타입을
 * 가져온다 — 레이어 간 직접 구현 의존 금지.
 */
export type { Bar, PriceSeries } from "./market";
export type {
  SignalAction,
  Signal,
  Strategy,
  UniverseHistory,
  StrategyProposal,
  StrategyFamily,
  RegimeStrategy,
} from "./strategy";
export type { Trade, Metrics, BacktestResult } from "./result";
export type {
  RegimeLabel,
  RegimeState,
  MacroContext,
  RegimeClassifier,
} from "./regime";
export type {
  SentimentSignal,
  RiskInputs,
  AggressivenessConfig,
  AggressivenessResult,
  ComputeAggressiveness,
} from "./sentiment";
export type {
  AllocationConfig,
  AllocationInput,
  MetaAllocation,
  Allocate,
} from "./allocation";
export type { Holding, AccountState } from "./account";
export type { Order, OrderResult } from "./order";
export type {
  ExecMode,
  LiveMode,
  AccountSource,
  MarketDataSource,
  OrderExecutor,
} from "./broker-port";
export type { GateCriteria, GateResult, EvaluateGate } from "./gate";
export type { BacktestRun, LiveSnapshot, ControlFlags } from "./artifact";
