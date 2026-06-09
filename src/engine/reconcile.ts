/**
 * 정산 (reconcile) — 목표 ↔ 현재 → 주문 (docs/coding/execution-and-data.md 4절).
 *
 * 백테스트·실거래 공용. 출력은 "사라"가 아니라 목표상태 차이.
 * 주문 = 목표금액 − 현재평가액.
 *
 * 확정된 결정:
 * - 유니버스 안에서만 정산. 유니버스 밖 보유는 절대 건드리지 않는다(매도 대상 X, NAV X).
 * - 금액 기반(notional) 주문. 토스 amount-based 주문에 직결.
 * - 무거래 밴드(minTradeNotional): 미세 드리프트는 거래하지 않는다(거래비용 통제).
 * - 통화 = USD 단일.
 */
import type { AccountState } from "../types/account";
import type { Order } from "../types/order";

export interface ReconcileConfig {
  /** 무거래 밴드: |delta| < minTradeNotional 이면 거래하지 않는다(USD) */
  readonly minTradeNotional: number;
}

/**
 * 목표비중과 현재 계좌를 정산해 주문 배열을 만든다.
 *
 * @param target   메타×적극도 적용된 목표비중 (심볼→비중)
 * @param account  현재 계좌 상태 (nav = 관리 자산)
 * @param universe 시스템이 손대는 종목 범위
 * @param cfg      정산 설정 (무거래 밴드)
 */
export function reconcile(
  target: Readonly<Record<string, number>>,
  account: AccountState,
  universe: ReadonlySet<string>,
  cfg: ReconcileConfig,
): Order[] {
  // 유니버스 안에서만 정산한다. 유니버스 밖 보유는 절대 건드리지 않는다.
  const symbols = new Set(
    [...Object.keys(target), ...Object.keys(account.holdings)].filter((s) =>
      universe.has(s),
    ),
  );

  const orders: Order[] = [];
  for (const sym of symbols) {
    const targetValue = (target[sym] ?? 0) * account.nav; // nav = 관리 자산
    const currentValue = account.holdings[sym]?.marketValue ?? 0;
    const delta = targetValue - currentValue;

    // 무거래 밴드: 미세 드리프트로 churn 방지 (거래비용 통제)
    if (Math.abs(delta) < cfg.minTradeNotional) continue;

    orders.push({
      symbol: sym,
      side: delta > 0 ? "BUY" : "SELL",
      notional: Math.abs(delta),
      reason: target[sym] === undefined ? "exit (not in target)" : "rebalance",
    });
  }
  return orders;
}
