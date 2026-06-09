/**
 * 실행/정산 레이어 배럴 (src/broker).
 *
 * 추상 포트 구현체(mock) + 안전장치 + LiveSnapshot/ControlFlags 유틸.
 * 토스 실어댑터(src/broker/toss)는 Phase 7에서 같은 인터페이스로 추가.
 */

// mock 어댑터 (AccountSource / MarketDataSource / OrderExecutor)
export { SimulatedAccount } from "./mock/simulated-account";
export type { SimulatedAccountInit } from "./mock/simulated-account";
export { SimulatedMarketData } from "./mock/simulated-market-data";
export type { SimulatedMarketDataInit } from "./mock/simulated-market-data";
export { SimulatedExecutor } from "./mock/simulated-executor";
export type { SimulatedExecutorInit } from "./mock/simulated-executor";

// 안전장치
export { SafeOrderExecutor } from "./safe-executor";
export type { SafeExecutorDeps, SafeSubmitOutcome } from "./safe-executor";
export { resolveMode, nextStepUp } from "./mode";
export type { ResolveModeResult } from "./mode";
export {
  makeClientOrderId,
  assignClientOrderId,
  dedupeAgainstOpen,
} from "./idempotency";
export type { DedupeResult } from "./idempotency";
export { checkSanity } from "./sanity";
export type { SanityConfig, SanityContext, SanityResult } from "./sanity";
export {
  alwaysOpenCalendar,
  alwaysClosedCalendar,
  predicateCalendar,
} from "./calendar";
export type { MarketCalendar } from "./calendar";

// ControlFlags 폴링 (fail-safe DRY_RUN)
export { readControlFlags, failSafeFlags } from "./control-flags";

// LiveSnapshot 산출
export {
  buildLiveSnapshot,
  writeLiveSnapshot,
  DEFAULT_SNAPSHOT_PATH,
} from "./live-snapshot";
export type { BuildSnapshotInput } from "./live-snapshot";
