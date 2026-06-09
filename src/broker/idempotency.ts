/**
 * 멱등성 (execution-and-data.md 8절).
 *
 * 가장 흔하고 위험한 실거래 버그(재시도·네트워크 오류로 인한 중복 주문)를 막는다.
 * - 모든 주문에 결정적 clientOrderId를 부여한다(같은 의도 → 같은 id).
 * - 제출 전 미체결 주문(openOrders) id와 대조해 이미 진행 중인 주문을 제외한다.
 */
import type { Order } from "../types/order";

/**
 * 결정적 clientOrderId. 같은 (cycleId, symbol, side, notional)는 같은 id가 되어
 * 재시도 시 중복으로 식별된다. 부동소수 흔들림 방지를 위해 notional은 소수 2자리로 양자화.
 */
export function makeClientOrderId(cycleId: string, order: Order): string {
  const notional = Math.round(order.notional * 100) / 100;
  return `${cycleId}:${order.symbol}:${order.side}:${notional}`;
}

/** 주문에 clientOrderId를 부여(이미 있으면 유지). 불변. */
export function assignClientOrderId(cycleId: string, order: Order): Order {
  if (order.clientOrderId) return order;
  return { ...order, clientOrderId: makeClientOrderId(cycleId, order) };
}

export interface DedupeResult {
  /** 새로 제출할 주문(미체결과 중복되지 않는 것) */
  readonly toSubmit: readonly Order[];
  /** 중복으로 차단된 주문 */
  readonly blocked: readonly Order[];
}

/**
 * 미체결 주문 id 집합과 대조해 중복을 차단한다.
 *
 * @param orders     clientOrderId가 부여된 주문들
 * @param openOrderIds 브로커 미체결 주문의 clientOrderId 집합
 */
export function dedupeAgainstOpen(
  orders: readonly Order[],
  openOrderIds: ReadonlySet<string>,
): DedupeResult {
  const toSubmit: Order[] = [];
  const blocked: Order[] = [];
  // 배치 내부 중복도 차단(같은 의도가 두 번 들어온 경우)
  const seen = new Set<string>();

  for (const order of orders) {
    const id = order.clientOrderId;
    if (id !== undefined && (openOrderIds.has(id) || seen.has(id))) {
      blocked.push(order);
      continue;
    }
    if (id !== undefined) seen.add(id);
    toSubmit.push(order);
  }
  return { toSubmit, blocked };
}
