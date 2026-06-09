import { describe, it, expect } from "vitest";
import { checkSanity, type SanityConfig } from "./sanity";
import type { Order } from "../types/order";
import type { AccountState, Holding } from "../types/account";

function holding(symbol: string, marketValue: number): Holding {
  return { symbol, quantity: 1, avgPrice: marketValue, marketValue, currency: "USD" };
}

function account(cash: number, holdings: Record<string, Holding> = {}): AccountState {
  return { accountSeq: "t", baseCurrency: "USD", cash, holdings, nav: cash, asOf: 0 };
}

function order(over: Partial<Order> = {}): Order {
  return { symbol: "AAPL", side: "BUY", notional: 500, reason: "rebalance", ...over };
}

const cfg: SanityConfig = {
  maxPriceDeviation: 0.1,
  maxOrderNotional: 10000,
  maxBatchNotional: 50000,
  maxOrderCount: 10,
  highValueThreshold: 1_000_000,
};

describe("checkSanity", () => {
  it("정상 주문은 통과", () => {
    const res = checkSanity([order()], { account: account(1000) }, cfg);
    expect(res.accepted).toHaveLength(1);
    expect(res.rejected).toHaveLength(0);
  });

  it("매수 notional > buying-power 거부", () => {
    const res = checkSanity([order({ notional: 2000 })], { account: account(1000) }, cfg);
    expect(res.accepted).toHaveLength(0);
    expect(res.rejected[0]?.reason).toContain("buying-power");
  });

  it("매도 notional > 보유 평가액 거부", () => {
    const acct = account(0, { AAPL: holding("AAPL", 300) });
    const res = checkSanity([order({ side: "SELL", notional: 500 })], { account: acct }, cfg);
    expect(res.accepted).toHaveLength(0);
    expect(res.rejected[0]?.reason).toContain("보유");
  });

  it("매도 notional ≤ 보유는 통과", () => {
    const acct = account(0, { AAPL: holding("AAPL", 600) });
    const res = checkSanity([order({ side: "SELL", notional: 500 })], { account: acct }, cfg);
    expect(res.accepted).toHaveLength(1);
  });

  it("가격 이탈(±maxPriceDeviation 초과) 거부", () => {
    const res = checkSanity(
      [order()],
      {
        account: account(1000),
        currentPrices: { AAPL: 100 },
        orderPrices: { AAPL: 130 }, // +30% > 10%
      },
      cfg,
    );
    expect(res.rejected[0]?.reason).toContain("가격 이탈");
  });

  it("가격 이탈 허용 범위 내면 통과", () => {
    const res = checkSanity(
      [order()],
      {
        account: account(1000),
        currentPrices: { AAPL: 100 },
        orderPrices: { AAPL: 105 }, // +5% < 10%
      },
      cfg,
    );
    expect(res.accepted).toHaveLength(1);
  });

  it("단건 한도 초과 거부", () => {
    const res = checkSanity([order({ notional: 20000 })], { account: account(100000) }, cfg);
    expect(res.rejected[0]?.reason).toContain("단건 한도");
  });

  it("배치 건수 한도 초과 시 초과분 거부", () => {
    const small: SanityConfig = { ...cfg, maxOrderCount: 1 };
    const orders = [
      order({ symbol: "AAPL", notional: 100 }),
      order({ symbol: "MSFT", notional: 100 }),
    ];
    const res = checkSanity(orders, { account: account(100000) }, small);
    expect(res.accepted).toHaveLength(1);
    expect(res.rejected[0]?.reason).toContain("건수 한도");
  });

  it("배치 합계 한도 초과 거부", () => {
    const small: SanityConfig = { ...cfg, maxBatchNotional: 150 };
    const orders = [
      order({ symbol: "AAPL", notional: 100 }),
      order({ symbol: "MSFT", notional: 100 }),
    ];
    const res = checkSanity(orders, { account: account(100000) }, small);
    expect(res.accepted).toHaveLength(1);
    expect(res.rejected[0]?.reason).toContain("배치 합계");
  });

  it("고액주문 미승인 거부", () => {
    const low: SanityConfig = { ...cfg, highValueThreshold: 400, maxOrderNotional: 100000 };
    const res = checkSanity([order({ notional: 500 })], { account: account(100000) }, low);
    expect(res.rejected[0]?.reason).toContain("고액");
  });

  it("고액주문 confirm 훅이 true면 통과", () => {
    const low: SanityConfig = { ...cfg, highValueThreshold: 400, maxOrderNotional: 100000 };
    const res = checkSanity(
      [order({ notional: 500 })],
      { account: account(100000), confirmHighValueOrder: () => true },
      low,
    );
    expect(res.accepted).toHaveLength(1);
  });

  it("비정상 notional(0 이하) 거부", () => {
    const res = checkSanity([order({ notional: 0 })], { account: account(1000) }, cfg);
    expect(res.rejected[0]?.reason).toContain("비정상");
  });

  it("누적 매수가 buying-power 공유 — 두 번째에서 잘림", () => {
    const orders = [
      order({ symbol: "AAPL", notional: 700 }),
      order({ symbol: "MSFT", notional: 700 }),
    ];
    const res = checkSanity(orders, { account: account(1000) }, cfg);
    // 700 통과, 잔여 300 < 700 → 두 번째 거부
    expect(res.accepted).toHaveLength(1);
    expect(res.rejected).toHaveLength(1);
  });
});
