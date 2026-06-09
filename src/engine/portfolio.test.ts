import { describe, it, expect } from "vitest";
import {
  emptyPortfolio,
  applyBuy,
  applySell,
  holdingsValue,
  nav,
} from "./portfolio";

describe("portfolio — 불변 패턴", () => {
  it("applyBuy는 입력 상태를 변이하지 않는다", () => {
    const s0 = emptyPortfolio(1000);
    const s1 = applyBuy(s0, "SPY", 5, 100, 1);
    expect(s0.cash).toBe(1000);
    expect(s0.positions).toEqual({});
    expect(s1).not.toBe(s0);
  });

  it("매수: 현금 차감(+비용), 수량·평단 반영", () => {
    const s = applyBuy(emptyPortfolio(1000), "SPY", 5, 100, 2);
    expect(s.cash).toBeCloseTo(1000 - 500 - 2, 10);
    expect(s.positions.SPY?.quantity).toBe(5);
    expect(s.positions.SPY?.avgPrice).toBeCloseTo(100, 10);
  });

  it("추가 매수: 평균단가 가중평균", () => {
    let s = applyBuy(emptyPortfolio(10000), "SPY", 10, 100, 0);
    s = applyBuy(s, "SPY", 10, 120, 0);
    expect(s.positions.SPY?.quantity).toBe(20);
    expect(s.positions.SPY?.avgPrice).toBeCloseTo(110, 10);
  });
});

describe("portfolio — 매도", () => {
  it("부분 매도: 현금 증가(−비용), 평단 유지", () => {
    let s = applyBuy(emptyPortfolio(10000), "SPY", 10, 100, 0);
    s = applySell(s, "SPY", 4, 110, 1);
    expect(s.cash).toBeCloseTo(10000 - 1000 + 4 * 110 - 1, 10);
    expect(s.positions.SPY?.quantity).toBe(6);
    expect(s.positions.SPY?.avgPrice).toBeCloseTo(100, 10);
  });
  it("전량 매도: 포지션 제거", () => {
    let s = applyBuy(emptyPortfolio(10000), "SPY", 10, 100, 0);
    s = applySell(s, "SPY", 10, 110, 0);
    expect(s.positions.SPY).toBeUndefined();
  });
  it("보유 초과 매도는 보유분까지만(음수 수량 방지)", () => {
    let s = applyBuy(emptyPortfolio(10000), "SPY", 5, 100, 0);
    s = applySell(s, "SPY", 999, 110, 0);
    expect(s.positions.SPY).toBeUndefined();
    expect(s.cash).toBeCloseTo(10000 - 500 + 5 * 110, 10);
  });
  it("없는 종목 매도는 무시", () => {
    const s0 = emptyPortfolio(1000);
    expect(applySell(s0, "AAPL", 1, 100, 0)).toEqual(s0);
  });
});

describe("portfolio — 평가·NAV", () => {
  it("holdingsValue: 보유×현재가 합", () => {
    let s = applyBuy(emptyPortfolio(10000), "SPY", 10, 100, 0);
    s = applyBuy(s, "QQQ", 5, 200, 0);
    expect(holdingsValue(s, { SPY: 110, QQQ: 210 })).toBeCloseTo(10 * 110 + 5 * 210, 10);
  });
  it("NAV = 현금 + 평가액", () => {
    const s = applyBuy(emptyPortfolio(10000), "SPY", 10, 100, 0);
    expect(nav(s, { SPY: 120 })).toBeCloseTo(10000 - 1000 + 10 * 120, 10);
  });
  it("유니버스 밖 보유는 NAV에서 제외", () => {
    let s = applyBuy(emptyPortfolio(10000), "SPY", 10, 100, 0);
    s = applyBuy(s, "TSLA", 1, 100, 0); // 유니버스 밖
    const uni = new Set(["SPY"]);
    expect(nav(s, { SPY: 100, TSLA: 9999 }, uni)).toBeCloseTo(10000 - 1000 - 100 + 10 * 100, 10);
  });
});
