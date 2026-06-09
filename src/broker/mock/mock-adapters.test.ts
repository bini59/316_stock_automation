import { describe, it, expect } from "vitest";
import { SimulatedAccount } from "./simulated-account";
import { SimulatedMarketData } from "./simulated-market-data";
import { SimulatedExecutor } from "./simulated-executor";
import type { Holding } from "../../types/account";
import type { Bar } from "../../types/market";
import type { Order } from "../../types/order";

function holding(symbol: string, marketValue: number): Holding {
  return { symbol, quantity: 1, avgPrice: marketValue, marketValue, currency: "USD" };
}

function bar(timestamp: number, close: number): Bar {
  return { timestamp, open: close, high: close, low: close, close, volume: 100 };
}

describe("SimulatedAccount", () => {
  it("NAV = 현금 + 유니버스 보유 평가액", async () => {
    const acct = new SimulatedAccount(
      {
        cash: 1000,
        holdings: { AAPL: holding("AAPL", 500) },
        universe: new Set(["AAPL"]),
      },
      () => 12345,
    );
    const state = await acct.getState();
    expect(state.nav).toBe(1500);
    expect(state.cash).toBe(1000);
    expect(state.asOf).toBe(12345);
  });

  it("유니버스 밖 보유는 NAV에서 제외(건드리지 않음)", async () => {
    const acct = new SimulatedAccount({
      cash: 1000,
      holdings: { AAPL: holding("AAPL", 500), TSLA: holding("TSLA", 999) },
      universe: new Set(["AAPL"]),
    });
    const state = await acct.getState();
    // TSLA 평가액은 NAV에 포함되지 않는다
    expect(state.nav).toBe(1500);
    // 보유 목록 자체는 그대로 노출(reconcile이 universe로 필터)
    expect(state.holdings["TSLA"]).toBeDefined();
  });

  it("universe 미지정 시 전체 보유 포함", async () => {
    const acct = new SimulatedAccount({
      cash: 1000,
      holdings: { AAPL: holding("AAPL", 500), TSLA: holding("TSLA", 200) },
    });
    const state = await acct.getState();
    expect(state.nav).toBe(1700);
  });

  it("withMarketValues는 불변(새 인스턴스, 원본 유지)", async () => {
    const acct = new SimulatedAccount({
      cash: 1000,
      holdings: { AAPL: holding("AAPL", 500) },
      universe: new Set(["AAPL"]),
    });
    const updated = acct.withMarketValues({ AAPL: 700 });
    expect((await acct.getState()).nav).toBe(1500); // 원본 불변
    expect((await updated.getState()).nav).toBe(1700);
  });
});

describe("SimulatedMarketData — look-ahead 차단", () => {
  const series = {
    AAPL: [bar(100, 10), bar(200, 11), bar(300, 12), bar(400, 13)],
  };

  it("currentPrice는 현재 시점(now)까지의 마지막 바만 노출", async () => {
    const md = new SimulatedMarketData({ series }, () => 250);
    // now=250 → 마지막 노출 가능 바는 t=200(close 11)
    expect(await md.currentPrice("AAPL")).toBe(11);
  });

  it("candles는 미래 바(now 이후)를 절대 노출하지 않는다", async () => {
    const md = new SimulatedMarketData({ series }, () => 250);
    const bars = await md.candles("AAPL", 0, 1000);
    // to=1000이지만 now=250이라 t=300,400은 잘린다
    expect(bars.map((b) => b.timestamp)).toEqual([100, 200]);
  });

  it("candles는 from..to 범위로 슬라이스", async () => {
    const md = new SimulatedMarketData({ series }, () => 9999);
    const bars = await md.candles("AAPL", 150, 350);
    expect(bars.map((b) => b.timestamp)).toEqual([200, 300]);
  });

  it("현재 시점 가격이 없으면 명시적 에러", async () => {
    const md = new SimulatedMarketData({ series }, () => 50); // 첫 바(100) 이전
    await expect(md.currentPrice("AAPL")).rejects.toThrow();
  });
});

describe("SimulatedExecutor — 모드별 체결", () => {
  const orders: Order[] = [{ symbol: "AAPL", side: "BUY", notional: 500, reason: "rebalance" }];

  it("DRY_RUN은 미제출(submitted:false, filled 0)", async () => {
    const exec = new SimulatedExecutor();
    const [r] = await exec.submit(orders, "DRY_RUN");
    expect(r?.submitted).toBe(false);
    expect(r?.filledNotional).toBe(0);
  });

  it("BACKTEST는 체결 시뮬레이션(submitted:true, 전량 체결)", async () => {
    const exec = new SimulatedExecutor({ priceOf: () => 150 });
    const [r] = await exec.submit(orders, "BACKTEST");
    expect(r?.submitted).toBe(true);
    expect(r?.filledNotional).toBe(500);
    expect(r?.fillPrice).toBe(150);
  });

  it("LIVE_SMALL/LIVE도 체결 시뮬레이션", async () => {
    const exec = new SimulatedExecutor();
    const [small] = await exec.submit(orders, "LIVE_SMALL");
    const [live] = await exec.submit(orders, "LIVE");
    expect(small?.submitted).toBe(true);
    expect(live?.submitted).toBe(true);
  });
});
