/**
 * 브로커 추상 포트 (docs/coding/execution-and-data.md 3절).
 *
 * 전략·엔진은 이 추상 인터페이스에만 의존한다. 토스는 구현체 하나,
 * 백테스트는 시뮬레이션 구현체 — 둘이 같은 reconcile 로직을 공유.
 */
import type { PriceSeries } from "./market";
import type { AccountState } from "./account";
import type { Order, OrderResult } from "./order";

/**
 * 실행 모드. BACKTEST는 시뮬레이션 체결, DRY_RUN은 계산·로깅만(미제출),
 * LIVE_SMALL/LIVE는 실제 제출.
 */
export type ExecMode = "BACKTEST" | "DRY_RUN" | "LIVE_SMALL" | "LIVE";

/** 실거래(스냅샷) 모드 — BACKTEST 제외 */
export type LiveMode = Exclude<ExecMode, "BACKTEST">;

export interface AccountSource {
  /** 현금+보유 (토스: holdings+buying-power+accounts) */
  getState(): Promise<AccountState>;
}

export interface MarketDataSource {
  candles(symbol: string, from: number, to: number): Promise<PriceSeries>;
  currentPrice(symbol: string): Promise<number>;
}

export interface OrderExecutor {
  /** dry-run이면 제출하지 않고 계획만 반환 */
  submit(orders: readonly Order[], mode: ExecMode): Promise<OrderResult[]>;
}
