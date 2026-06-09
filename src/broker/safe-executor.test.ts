import { describe, it, expect } from "vitest";
import { SafeOrderExecutor, type SafeExecutorDeps } from "./safe-executor";
import { SimulatedExecutor } from "./mock/simulated-executor";
import { alwaysOpenCalendar, alwaysClosedCalendar } from "./calendar";
import type { SanityConfig } from "./sanity";
import type { ControlFlags } from "../types/artifact";
import type { AccountState, Holding } from "../types/account";
import type { Order } from "../types/order";

function holding(symbol: string, marketValue: number): Holding {
  return { symbol, quantity: 1, avgPrice: marketValue, marketValue, currency: "USD" };
}

function account(cash: number, holdings: Record<string, Holding> = {}): AccountState {
  return { accountSeq: "t", baseCurrency: "USD", cash, holdings, nav: cash, asOf: 0 };
}

function flags(over: Partial<ControlFlags> = {}): ControlFlags {
  return {
    killSwitch: false,
    paused: false,
    requestedMode: "LIVE",
    updatedAt: 0,
    updatedBy: "test",
    ...over,
  };
}

const sanityConfig: SanityConfig = {
  maxPriceDeviation: 0.1,
  maxOrderNotional: 100000,
  maxBatchNotional: 1000000,
  maxOrderCount: 50,
  highValueThreshold: 1_000_000,
};

function makeDeps(over: Partial<SafeExecutorDeps> = {}): SafeExecutorDeps {
  return {
    inner: new SimulatedExecutor({ priceOf: () => 100 }),
    getFlags: async () => flags(),
    getAccount: async () => account(100000),
    getOpenOrderIds: async () => new Set(),
    calendar: alwaysOpenCalendar,
    sanityConfig,
    clock: () => 1000,
    ...over,
  };
}

const buyOrder: Order = { symbol: "AAPL", side: "BUY", notional: 500, reason: "rebalance" };

describe("SafeOrderExecutor", () => {
  it("LIVE + 정상 → 실제 제출", async () => {
    const safe = new SafeOrderExecutor(makeDeps());
    const out = await safe.submitGuarded([buyOrder], "LIVE");
    expect(out.effectiveMode).toBe("LIVE");
    expect(out.results[0]?.submitted).toBe(true);
  });

  it("killSwitch → DRY_RUN 강등, 미제출", async () => {
    const safe = new SafeOrderExecutor(
      makeDeps({ getFlags: async () => flags({ killSwitch: true }) }),
    );
    const out = await safe.submitGuarded([buyOrder], "LIVE");
    expect(out.effectiveMode).toBe("DRY_RUN");
    expect(out.results[0]?.submitted).toBe(false);
  });

  it("점프 승급 차단 (DRY_RUN 현재 + LIVE 요청 → LIVE_SMALL)", async () => {
    const safe = new SafeOrderExecutor(
      makeDeps({ getFlags: async () => flags({ requestedMode: "LIVE" }) }),
    );
    const out = await safe.submitGuarded([buyOrder], "DRY_RUN");
    expect(out.effectiveMode).toBe("LIVE_SMALL");
  });

  it("멱등성: 미체결과 중복되는 주문은 제출 안 됨", async () => {
    // cycleId 'c1'로 결정적 id 생성 후 그 id를 openOrders에 넣어둔다
    const safe = new SafeOrderExecutor(
      makeDeps({ getOpenOrderIds: async () => new Set(["c1:AAPL:BUY:500"]) }),
    );
    const out = await safe.submitGuarded([buyOrder], "LIVE", "c1");
    const submitted = out.results.filter((r) => r.submitted);
    expect(submitted).toHaveLength(0);
    expect(out.results[0]?.note).toContain("duplicate");
  });

  it("sanity 거부: 매도 > 보유", async () => {
    const sell: Order = { symbol: "AAPL", side: "SELL", notional: 500, reason: "exit" };
    const safe = new SafeOrderExecutor(
      makeDeps({ getAccount: async () => account(0, { AAPL: holding("AAPL", 100) }) }),
    );
    const out = await safe.submitGuarded([sell], "LIVE");
    expect(out.results[0]?.submitted).toBe(false);
    expect(out.results[0]?.note).toContain("sanity");
  });

  it("sanity 거부: 매수 > buying-power", async () => {
    const safe = new SafeOrderExecutor(
      makeDeps({ getAccount: async () => account(100) }),
    );
    const out = await safe.submitGuarded([buyOrder], "LIVE");
    expect(out.results[0]?.submitted).toBe(false);
  });

  it("가격 이탈 거부", async () => {
    const safe = new SafeOrderExecutor(
      makeDeps({
        sanityContextExtras: {
          currentPrices: { AAPL: 100 },
          orderPrices: { AAPL: 200 },
        },
      }),
    );
    const out = await safe.submitGuarded([buyOrder], "LIVE");
    expect(out.results[0]?.submitted).toBe(false);
  });

  it("휴장 가드: 실주문 모드라도 휴장이면 미제출", async () => {
    const safe = new SafeOrderExecutor(makeDeps({ calendar: alwaysClosedCalendar }));
    const out = await safe.submitGuarded([buyOrder], "LIVE");
    // 유효 모드는 LIVE지만 휴장이라 inner는 DRY_RUN으로 호출 → 미제출
    expect(out.effectiveMode).toBe("LIVE");
    expect(out.results[0]?.submitted).toBe(false);
  });

  it("DRY_RUN 모드는 휴장이어도 계산은 진행(미제출)", async () => {
    const safe = new SafeOrderExecutor(
      makeDeps({
        getFlags: async () => flags({ requestedMode: "DRY_RUN" }),
        calendar: alwaysClosedCalendar,
      }),
    );
    const out = await safe.submitGuarded([buyOrder], "DRY_RUN");
    expect(out.effectiveMode).toBe("DRY_RUN");
    expect(out.results[0]?.submitted).toBe(false);
  });

  it("fail-safe: getFlags가 보수적 DRY_RUN을 주면 미제출", async () => {
    // ControlFlags 폴링 실패를 시뮬레이션: getFlags가 fail-safe 값을 반환
    const safe = new SafeOrderExecutor(
      makeDeps({
        getFlags: async () => flags({ killSwitch: true, requestedMode: "DRY_RUN" }),
      }),
    );
    const out = await safe.submitGuarded([buyOrder], "LIVE");
    expect(out.effectiveMode).toBe("DRY_RUN");
    expect(out.results[0]?.submitted).toBe(false);
  });

  it("submit() 계약: OrderResult 배열만 반환", async () => {
    const safe = new SafeOrderExecutor(makeDeps());
    const results = await safe.submit([buyOrder], "LIVE");
    expect(Array.isArray(results)).toBe(true);
    expect(results[0]?.submitted).toBe(true);
  });

  it("BACKTEST 모드 요청은 DRY_RUN으로 매핑(submit 경로)", async () => {
    // 플래그도 DRY_RUN을 요청하면 BACKTEST는 DRY_RUN으로 매핑되어 미제출
    const safe = new SafeOrderExecutor(
      makeDeps({ getFlags: async () => flags({ requestedMode: "DRY_RUN" }) }),
    );
    const results = await safe.submit([buyOrder], "BACKTEST");
    expect(results[0]?.submitted).toBe(false);
  });
});
