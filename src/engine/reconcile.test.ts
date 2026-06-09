import { describe, it, expect } from "vitest";
import { reconcile, type ReconcileConfig } from "./reconcile";
import type { AccountState, Holding } from "../types/account";

function holding(symbol: string, marketValue: number): Holding {
  return { symbol, quantity: 1, avgPrice: marketValue, marketValue, currency: "USD" };
}

function account(
  holdings: Record<string, Holding>,
  nav: number,
  cash = 0,
): AccountState {
  return {
    accountSeq: "test",
    baseCurrency: "USD",
    cash,
    holdings,
    nav,
    asOf: 0,
  };
}

const cfg: ReconcileConfig = { minTradeNotional: 1 };

describe("reconcile — target-weight 정산", () => {
  it("안 가진 종목도 목표에 있으면 매수한다", () => {
    const acct = account({}, 1000);
    const orders = reconcile({ AAPL: 0.5 }, acct, new Set(["AAPL"]), cfg);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ symbol: "AAPL", side: "BUY", notional: 500 });
  });

  it("목표 = 목표금액 − 현재평가액 델타", () => {
    const acct = account({ AAPL: holding("AAPL", 300) }, 1000);
    const orders = reconcile({ AAPL: 0.5 }, acct, new Set(["AAPL"]), cfg);
    // target 500, current 300 → BUY 200
    expect(orders[0]).toMatchObject({ symbol: "AAPL", side: "BUY", notional: 200 });
  });

  it("목표가 현재보다 작으면 매도", () => {
    const acct = account({ AAPL: holding("AAPL", 700) }, 1000);
    const orders = reconcile({ AAPL: 0.3 }, acct, new Set(["AAPL"]), cfg);
    // target 300, current 700 → SELL 400
    expect(orders[0]).toMatchObject({ symbol: "AAPL", side: "SELL", notional: 400 });
  });

  it("유니버스 밖 보유는 절대 건드리지 않는다(매도 대상 아님)", () => {
    const acct = account(
      { AAPL: holding("AAPL", 300), TSLA: holding("TSLA", 500) },
      1000,
    );
    // universe는 AAPL만. TSLA는 목표에 없지만 매도하지 않아야 한다.
    const orders = reconcile({ AAPL: 0.5 }, acct, new Set(["AAPL"]), cfg);
    expect(orders.map((o) => o.symbol)).not.toContain("TSLA");
  });

  it("유니버스 밖 종목은 목표에 있어도 정산 대상 아님", () => {
    const acct = account({}, 1000);
    const orders = reconcile({ TSLA: 0.5 }, acct, new Set(["AAPL"]), cfg);
    expect(orders).toHaveLength(0);
  });

  it("무거래 밴드: 미세 드리프트는 거래하지 않는다(churn 방지)", () => {
    const acct = account({ AAPL: holding("AAPL", 499.5) }, 1000);
    // target 500, current 499.5 → delta 0.5 < minTradeNotional(1) → skip
    const orders = reconcile({ AAPL: 0.5 }, acct, new Set(["AAPL"]), {
      minTradeNotional: 1,
    });
    expect(orders).toHaveLength(0);
  });

  it("밴드 경계: delta가 밴드 이상이면 거래한다", () => {
    const acct = account({ AAPL: holding("AAPL", 400) }, 1000);
    const orders = reconcile({ AAPL: 0.5 }, acct, new Set(["AAPL"]), {
      minTradeNotional: 50,
    });
    // delta 100 >= 50 → 거래
    expect(orders).toHaveLength(1);
  });

  it("목표에서 사라진 보유는 exit 사유로 전량 매도", () => {
    const acct = account({ AAPL: holding("AAPL", 400) }, 1000);
    const orders = reconcile({}, acct, new Set(["AAPL"]), cfg);
    expect(orders[0]).toMatchObject({
      symbol: "AAPL",
      side: "SELL",
      notional: 400,
      reason: "exit (not in target)",
    });
  });

  it("목표에 있으면 reason은 rebalance", () => {
    const acct = account({ AAPL: holding("AAPL", 300) }, 1000);
    const orders = reconcile({ AAPL: 0.5 }, acct, new Set(["AAPL"]), cfg);
    expect(orders[0]?.reason).toBe("rebalance");
  });

  it("targetValue는 target비중 × nav (관리 자산 기준)", () => {
    const acct = account({}, 2000); // nav 2000
    const orders = reconcile({ AAPL: 0.25 }, acct, new Set(["AAPL"]), cfg);
    expect(orders[0]?.notional).toBe(500); // 0.25 × 2000
  });

  it("여러 종목을 동시에 정산", () => {
    const acct = account(
      { AAPL: holding("AAPL", 300), MSFT: holding("MSFT", 600) },
      1000,
    );
    const orders = reconcile(
      { AAPL: 0.5, MSFT: 0.3 },
      acct,
      new Set(["AAPL", "MSFT"]),
      cfg,
    );
    const bySym = Object.fromEntries(orders.map((o) => [o.symbol, o]));
    expect(bySym["AAPL"]).toMatchObject({ side: "BUY", notional: 200 }); // 500-300
    expect(bySym["MSFT"]).toMatchObject({ side: "SELL", notional: 300 }); // 300-600
  });
});
