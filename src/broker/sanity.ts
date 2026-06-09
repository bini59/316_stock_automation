/**
 * 사전 sanity 체크 + 주문 한도 (execution-and-data.md 8절).
 *
 * 제출 직전 가드:
 * - 가격 이탈: 주문 기준가가 현재가에서 ±maxPriceDeviation 초과면 거부.
 * - 매도수량 ≤ 보유: 매도 notional이 보유 평가액 초과면 거부.
 * - 매수금액 ≤ buying-power: 누적 매수 notional이 가용 현금 초과면 거부.
 * - 고액주문: highValueThreshold 초과면 confirmHighValueOrder 훅으로 승인 필요.
 * - 주문 한도: 1회 최대 건수·금액, 단건 최대 금액 캡(LIVE_SMALL은 작게).
 *
 * 모든 거부는 조용히 삼키지 않고 사유와 함께 반환한다(fail explicitly).
 */
import type { Order } from "../types/order";
import type { AccountState } from "../types/account";

export interface SanityConfig {
  /** 주문 기준가 vs 현재가 허용 이탈 비율 (예: 0.1 = ±10%) */
  readonly maxPriceDeviation: number;
  /** 단건 최대 notional (USD) */
  readonly maxOrderNotional: number;
  /** 1회 배치 최대 합계 notional (USD) */
  readonly maxBatchNotional: number;
  /** 1회 배치 최대 주문 건수 */
  readonly maxOrderCount: number;
  /** 고액주문 임계 (USD). 초과 시 confirmHighValueOrder 필요 */
  readonly highValueThreshold: number;
}

export interface SanityContext {
  readonly account: AccountState;
  /** 심볼→현재가 (가격 이탈 검사용). 미지정이면 가격 검사 생략 */
  readonly currentPrices?: Readonly<Record<string, number>>;
  /** 주문 기준가 (심볼→가격). 미지정이면 currentPrices와 동일로 간주 */
  readonly orderPrices?: Readonly<Record<string, number>>;
  /** 고액주문 승인 훅. true면 통과. 미지정이면 고액주문 거부 */
  readonly confirmHighValueOrder?: (order: Order) => boolean;
}

export interface SanityResult {
  /** 통과한 주문 */
  readonly accepted: readonly Order[];
  /** 거부된 주문 + 사유 */
  readonly rejected: readonly { order: Order; reason: string }[];
}

/**
 * 배치 단위 sanity 검증. 매수 누적은 buying-power(현금) 한도를 공유하므로 순차 처리.
 */
export function checkSanity(
  orders: readonly Order[],
  ctx: SanityContext,
  cfg: SanityConfig,
): SanityResult {
  const accepted: Order[] = [];
  const rejected: { order: Order; reason: string }[] = [];

  // 건수 캡: 초과분은 거부
  let remainingCount = cfg.maxOrderCount;
  let remainingBatch = cfg.maxBatchNotional;
  let remainingBuyingPower = ctx.account.cash;

  for (const order of orders) {
    const reason = rejectionReason(order, ctx, cfg, {
      remainingCount,
      remainingBatch,
      remainingBuyingPower,
    });
    if (reason !== null) {
      rejected.push({ order, reason });
      continue;
    }
    accepted.push(order);
    remainingCount -= 1;
    remainingBatch -= order.notional;
    if (order.side === "BUY") remainingBuyingPower -= order.notional;
  }

  return { accepted, rejected };
}

interface Budget {
  readonly remainingCount: number;
  readonly remainingBatch: number;
  readonly remainingBuyingPower: number;
}

/** 거부 사유 문자열, 통과면 null */
function rejectionReason(
  order: Order,
  ctx: SanityContext,
  cfg: SanityConfig,
  budget: Budget,
): string | null {
  if (!(order.notional > 0)) {
    return `비정상 notional(${order.notional})`;
  }
  if (budget.remainingCount <= 0) {
    return `주문 건수 한도 초과(max ${cfg.maxOrderCount})`;
  }
  if (order.notional > cfg.maxOrderNotional) {
    return `단건 한도 초과(${order.notional} > ${cfg.maxOrderNotional})`;
  }
  if (order.notional > budget.remainingBatch) {
    return `배치 합계 한도 초과(${cfg.maxBatchNotional})`;
  }

  // 가격 이탈
  const priceReason = priceDeviationReason(order, ctx, cfg);
  if (priceReason !== null) return priceReason;

  if (order.side === "SELL") {
    const held = ctx.account.holdings[order.symbol]?.marketValue ?? 0;
    // 부동소수 여유(epsilon)
    if (order.notional > held + 1e-6) {
      return `매도 notional > 보유 평가액(${order.notional} > ${held})`;
    }
  } else {
    // BUY: 누적 매수 ≤ buying-power
    if (order.notional > budget.remainingBuyingPower + 1e-6) {
      return `매수 notional > buying-power 잔여(${order.notional} > ${budget.remainingBuyingPower})`;
    }
  }

  // 고액주문 confirm
  if (order.notional > cfg.highValueThreshold) {
    const ok = ctx.confirmHighValueOrder?.(order) ?? false;
    if (!ok) {
      return `고액주문 미승인(${order.notional} > ${cfg.highValueThreshold})`;
    }
  }

  return null;
}

function priceDeviationReason(
  order: Order,
  ctx: SanityContext,
  cfg: SanityConfig,
): string | null {
  const cur = ctx.currentPrices?.[order.symbol];
  if (cur === undefined || !(cur > 0)) return null; // 가격 없으면 검사 생략
  const ordered = ctx.orderPrices?.[order.symbol] ?? cur;
  const dev = Math.abs(ordered - cur) / cur;
  if (dev > cfg.maxPriceDeviation) {
    return `가격 이탈 ${(dev * 100).toFixed(1)}% > ${(cfg.maxPriceDeviation * 100).toFixed(1)}%`;
  }
  return null;
}
