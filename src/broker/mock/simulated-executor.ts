/**
 * 시뮬레이션 체결 (OrderExecutor 구현체).
 *
 * 모드별 동작:
 * - BACKTEST / LIVE_SMALL / LIVE: 체결 시뮬레이션(submitted:true, 전량 체결 가정).
 * - DRY_RUN: 계산·로깅만, 미제출(submitted:false, filledNotional:0).
 *
 * DRY_RUN이 페이퍼트레이딩을 대신한다(execution-and-data.md 1절): 실데이터로
 * 주문까지 *계산*하되 제출 직전에 멈춘다. mock에서는 같은 규칙을 그대로 따른다.
 *
 * 체결가는 주입된 price 함수(현재 시점까지)로 결정 — look-ahead 차단 유지.
 */
import type { OrderExecutor, ExecMode } from "../../types/broker-port";
import type { Order, OrderResult } from "../../types/order";

export interface SimulatedExecutorInit {
  /** 심볼→현재 체결가 조회. 미지정 시 fillPrice undefined(notional만 체결) */
  readonly priceOf?: (symbol: string) => number | undefined;
}

export class SimulatedExecutor implements OrderExecutor {
  private readonly priceOf: ((symbol: string) => number | undefined) | undefined;

  constructor(init: SimulatedExecutorInit = {}) {
    this.priceOf = init.priceOf;
  }

  async submit(orders: readonly Order[], mode: ExecMode): Promise<OrderResult[]> {
    return orders.map((order) => this.simulateOne(order, mode));
  }

  private simulateOne(order: Order, mode: ExecMode): OrderResult {
    if (mode === "DRY_RUN") {
      return {
        order,
        submitted: false,
        filledNotional: 0,
        note: "DRY_RUN: computed only, not submitted",
      };
    }

    // BACKTEST / LIVE_SMALL / LIVE: 전량 체결 가정
    const px = this.priceOf?.(order.symbol);
    return {
      order,
      submitted: true,
      filledNotional: order.notional,
      ...(px !== undefined ? { fillPrice: px } : {}),
      brokerOrderId: `SIM-${order.symbol}-${order.side}`,
      note: `simulated fill (${mode})`,
    };
  }
}
