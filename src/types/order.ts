/**
 * 주문 타입 (docs/coding/execution-and-data.md 4절).
 *
 * 금액 기반(notional) 주문 — 토스 amount-based 주문에 직결.
 * target-weight 시스템과 궁합이 좋고 단주 반올림 로직이 거의 사라진다.
 */

export interface Order {
  symbol: string;
  side: "BUY" | "SELL";
  /** 금액 기반 (USD) */
  notional: number;
  /** "exit (not in target)" | "rebalance" 등 정산 사유 */
  reason: string;
  /** 멱등성: 클라이언트 측 식별자 (중복 주문 차단용, 실행 레이어에서 부여) */
  clientOrderId?: string;
}

export interface OrderResult {
  order: Order;
  /** 실제 제출 여부 (DRY_RUN/킬스위치면 false) */
  submitted: boolean;
  /** 체결 금액 (부분 체결 가능). 미제출이면 0 */
  filledNotional: number;
  /** 체결가(평균). 미제출이면 undefined */
  fillPrice?: number;
  /** 브로커 주문 식별자 */
  brokerOrderId?: string;
  /** 거부·실패 사유 또는 dry-run 메모 */
  note?: string;
}
