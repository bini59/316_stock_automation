/**
 * 타입 계약 스모크 테스트 (TODO 1.13: look-ahead 타입 가드 검토).
 *
 * 이 파일은 두 가지를 못 박는다.
 * 1) 각 레이어의 입출력 타입이 문서와 1:1로 사용 가능한지 (컴파일+런타임).
 * 2) look-ahead 차단: 전략·분류기·제안 함수는 PriceSeries("현재까지" 슬라이스)
 *    만 받는다. 미래 데이터 접근 경로가 시그니처에 존재하지 않음을 명시.
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  Bar,
  PriceSeries,
  Strategy,
  RegimeStrategy,
  RegimeClassifier,
  RegimeState,
  StrategyProposal,
  AccountState,
  Order,
  BacktestRun,
  LiveSnapshot,
  ControlFlags,
} from "./index";

const bar = (t: number, close: number): Bar => ({
  timestamp: t,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1000,
});

const series: PriceSeries = [bar(1, 100), bar(2, 101), bar(3, 102)];

describe("타입 계약 — look-ahead 차단", () => {
  it("Strategy.next 는 PriceSeries만 받는다 (미래 접근 경로 없음)", () => {
    const s: Strategy = {
      name: "noop",
      params: {},
      next: (history) => {
        expectTypeOf(history).toEqualTypeOf<PriceSeries>();
        return { action: "HOLD", strength: 0 };
      },
    };
    // 현재까지 슬라이스만 전달 가능 — 전체 시계열을 줘도 미래를 "볼" 인덱스가 없음
    const sig = s.next(series.slice(0, 2));
    expect(sig.action).toBe("HOLD");
  });

  it("RegimeClassifier.classify 는 history(+ctx)만 받는다", () => {
    const c: RegimeClassifier = {
      name: "stub",
      params: {},
      classify: (history): RegimeState => ({
        asOf: history[history.length - 1]?.timestamp ?? 0,
        trend: 0,
        volatility: 0,
        trendQuality: 0,
        membership: { bull: 0.25, bear: 0.25, chop: 0.25, crisis: 0.25 },
        label: "chop",
        confidence: 0,
      }),
    };
    const st = c.classify(series.slice(0, 2));
    const sum =
      st.membership.bull + st.membership.bear + st.membership.chop + st.membership.crisis;
    expect(sum).toBeCloseTo(1, 10);
  });

  it("RegimeStrategy.propose 는 UniverseHistory + RegimeState만 받는다", () => {
    const rs: RegimeStrategy = {
      name: "cash",
      family: "cash",
      regimeAffinity: { crisis: 1 },
      params: {},
      propose: () => ({}),
    };
    const proposal: StrategyProposal = {
      strategy: rs.name,
      activation: 1,
      weights: rs.propose({ SPY: series }, {
        asOf: 3,
        trend: 0,
        volatility: 1,
        trendQuality: 0,
        membership: { bull: 0, bear: 0, chop: 0, crisis: 1 },
        label: "crisis",
        confidence: 1,
      }),
    };
    expect(proposal.weights).toEqual({});
  });
});

describe("타입 계약 — 실행/산출물 shape", () => {
  it("AccountState/Order/artifact shape가 문서와 일치", () => {
    const account: AccountState = {
      accountSeq: "X",
      baseCurrency: "USD",
      cash: 1000,
      holdings: {},
      nav: 1000,
      asOf: 0,
    };
    const order: Order = { symbol: "SPY", side: "BUY", notional: 500, reason: "rebalance" };
    expectTypeOf(account.baseCurrency).toEqualTypeOf<"USD">();
    expect(order.side).toBe("BUY");

    const run: BacktestRun = {
      id: "r1",
      createdAt: 0,
      params: {},
      universe: ["SPY"],
      dateRange: { from: 1, to: 3 },
      split: { inSampleEnd: 2 },
      result: { equityCurve: [1000], trades: [], metrics: { totalReturn: 0, sharpe: 0, maxDrawdown: 0, winRate: 0, tradeCount: 0 } },
      gate: { passed: true, reasons: [] },
      triesIndex: 1,
    };
    expect(run.split.inSampleEnd).toBe(2);

    const snap: LiveSnapshot = {
      asOf: 0,
      mode: "DRY_RUN",
      account,
      regime: {
        asOf: 0,
        trend: 0,
        volatility: 0,
        trendQuality: 0,
        membership: { bull: 1, bear: 0, chop: 0, crisis: 0 },
        label: "bull",
        confidence: 1,
      },
      aggressiveness: 1,
      targetWeights: { SPY: 0.5 },
      openOrders: [order],
      recentDecisions: [],
      pnl: { day: 0, total: 0 },
    };
    expect(snap.mode).toBe("DRY_RUN");

    const flags: ControlFlags = {
      killSwitch: false,
      paused: false,
      requestedMode: "DRY_RUN",
      updatedAt: 0,
      updatedBy: "test",
    };
    expect(flags.killSwitch).toBe(false);
  });
});
