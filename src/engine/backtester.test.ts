import { describe, it, expect } from "vitest";
import { backtest, backtestPortfolio } from "./backtester";
import { Broker, usBrokerConfig } from "./broker";
import type { Bar, PriceSeries } from "../types/market";
import type { Strategy, UniverseHistory } from "../types/strategy";
import type { Signal } from "../types/strategy";

const bar = (t: number, close: number): Bar => ({
  timestamp: t,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1000,
});

const series = (closes: number[]): PriceSeries => closes.map((c, i) => bar(i + 1, c));
const zeroCost = () =>
  new Broker(usBrokerConfig({ commissionRate: 0, feeRate: 0, fxSpread: 0, slippageRate: 0 }));

/** 첫 바에서 BUY, 마지막 바에서 SELL 하는 결정적 전략 */
function buyFirstSellLast(len: number): Strategy {
  let calls = 0;
  return {
    name: "buyFirstSellLast",
    params: {},
    next(history): Signal {
      calls++;
      if (calls === 1) return { action: "BUY", strength: 1 };
      if (history.length === len) return { action: "SELL", strength: 1 };
      return { action: "HOLD", strength: 0 };
    },
  };
}

describe("backtest 단일종목", () => {
  it("상승장 매수-매도: 양의 수익(비용 0)", () => {
    const data = series([100, 110, 120]);
    const r = backtest(buyFirstSellLast(3), data, zeroCost(), 10000);
    expect(r.equityCurve.length).toBe(3);
    expect(r.metrics.totalReturn).toBeGreaterThan(0);
    expect(r.trades.length).toBe(1);
  });

  it("거래비용이 수익을 갉아먹는다(비용 on < 비용 off)", () => {
    const data = series([100, 110, 120]);
    const off = backtest(buyFirstSellLast(3), data, zeroCost(), 10000);
    const on = backtest(
      buyFirstSellLast(3),
      data,
      new Broker(usBrokerConfig({ commissionRate: 0.01, slippageRate: 0.01 })),
      10000,
    );
    const lastOff = off.equityCurve[off.equityCurve.length - 1]!;
    const lastOn = on.equityCurve[on.equityCurve.length - 1]!;
    expect(lastOn).toBeLessThan(lastOff);
  });

  it("HOLD만 하면 거래 0, equity 평탄", () => {
    const data = series([100, 100, 100]);
    const hold: Strategy = { name: "h", params: {}, next: () => ({ action: "HOLD", strength: 0 }) };
    const r = backtest(hold, data, zeroCost(), 10000);
    expect(r.trades.length).toBe(0);
    expect(r.equityCurve).toEqual([10000, 10000, 10000]);
  });
});

describe("★ look-ahead 차단 (단일종목)", () => {
  it("전략은 매 시점 정확히 i+1개 바만 보고, 마지막 바는 data[i]다", () => {
    const data = series([100, 101, 102, 103, 104]);
    const seen: { len: number; lastClose: number }[] = [];
    const spy: Strategy = {
      name: "spy",
      params: {},
      next(history) {
        seen.push({ len: history.length, lastClose: history[history.length - 1]!.close });
        return { action: "HOLD", strength: 0 };
      },
    };
    backtest(spy, data, zeroCost(), 10000);
    expect(seen.map((s) => s.len)).toEqual([1, 2, 3, 4, 5]);
    expect(seen.map((s) => s.lastClose)).toEqual([100, 101, 102, 103, 104]);
  });

  it("프리픽스 불변성: 미래 데이터를 잘라내도 과거 결정이 동일", () => {
    const full = series([100, 102, 101, 105, 99, 110]);
    const prefix = full.slice(0, 4);
    const decisionsFull: string[] = [];
    const decisionsPrefix: string[] = [];
    const mk = (sink: string[]): Strategy => ({
      name: "rec",
      params: {},
      next(history) {
        const last = history[history.length - 1]!.close;
        const prev = history[history.length - 2]?.close ?? last;
        const action = last > prev ? "BUY" : "SELL";
        sink.push(action);
        return { action, strength: 1 };
      },
    });
    backtest(mk(decisionsFull), full, zeroCost(), 10000);
    backtest(mk(decisionsPrefix), prefix, zeroCost(), 10000);
    // 앞 4개 결정은 미래 6개 데이터 유무와 무관하게 같아야 한다
    expect(decisionsFull.slice(0, 4)).toEqual(decisionsPrefix);
  });
});

describe("backtestPortfolio 다중종목", () => {
  const universe: UniverseHistory = {
    SPY: series([100, 100, 100, 100]),
    QQQ: series([200, 200, 200, 200]),
  };

  it("all-cash 목표 → 거래 0, equity = 초기자본 유지", () => {
    const r = backtestPortfolio({
      universe,
      broker: zeroCost(),
      initialCapital: 10000,
      targetWeights: () => ({}),
    });
    expect(r.trades.length).toBe(0);
    expect(r.equityCurve.every((e) => Math.abs(e - 10000) < 1e-6)).toBe(true);
  });

  it("100% SPY (비용 0, 가격 일정) → equity 보존", () => {
    const r = backtestPortfolio({
      universe,
      broker: zeroCost(),
      initialCapital: 10000,
      targetWeights: () => ({ SPY: 1 }),
    });
    const last = r.equityCurve[r.equityCurve.length - 1]!;
    expect(last).toBeCloseTo(10000, 4);
  });

  it("비용 on이면 리밸런싱 진입 시 equity 감소(비용 반영)", () => {
    const r = backtestPortfolio({
      universe,
      broker: new Broker(usBrokerConfig({ commissionRate: 0.01, slippageRate: 0.01 })),
      initialCapital: 10000,
      targetWeights: () => ({ SPY: 1 }),
    });
    const last = r.equityCurve[r.equityCurve.length - 1]!;
    expect(last).toBeLessThan(10000);
  });

  it("무거래 밴드: 작은 델타는 무시", () => {
    let rebalances = 0;
    backtestPortfolio({
      universe,
      broker: zeroCost(),
      initialCapital: 10000,
      minTradeNotional: 1e9, // 사실상 모든 거래 차단
      targetWeights: () => {
        rebalances++;
        return { SPY: 0.5 };
      },
    });
    expect(rebalances).toBeGreaterThan(0); // 호출은 되지만
  });

  it("★ churn 억제: 고정 target + 미세 드리프트에서 무거래 밴드가 거래 폭증을 막는다", () => {
    // +0.1%/bar로 천천히 오르는 단일 자산, target 고정 0.5
    const closes = Array.from({ length: 40 }, (_, i) => 100 * (1 + 0.001 * i));
    const uni: UniverseHistory = { SPY: series(closes) };
    const fixedTarget = () => ({ SPY: 0.5 });

    const withBand = backtestPortfolio({
      universe: uni,
      broker: zeroCost(),
      initialCapital: 10000,
      targetWeights: fixedTarget,
    });
    const noBand = backtestPortfolio({
      universe: uni,
      broker: zeroCost(),
      initialCapital: 10000,
      minTradeFraction: 0,
      minTradeNotional: 0,
      targetWeights: fixedTarget,
    });

    // 기본 밴드(0.5%)가 드리프트 churn을 크게 줄인다
    expect(noBand.trades.length).toBeGreaterThan(10);
    expect(withBand.trades.length).toBeLessThan(noBand.trades.length);
  });

  it("★ look-ahead: targetWeights는 i+1개 바 슬라이스만 받는다", () => {
    const seenLens: number[] = [];
    backtestPortfolio({
      universe,
      broker: zeroCost(),
      initialCapital: 10000,
      targetWeights: (histories, i) => {
        const spyLen = histories.SPY?.length ?? 0;
        seenLens.push(spyLen);
        expect(spyLen).toBe(i + 1);
        expect(histories.SPY?.[spyLen - 1]?.timestamp).toBe(universe.SPY![i]!.timestamp);
        return {};
      },
    });
    expect(seenLens).toEqual([1, 2, 3, 4]);
  });
});
