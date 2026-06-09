import { describe, it, expect } from "vitest";
import {
  computeMetrics,
  maxDrawdown,
  annualizedSharpe,
  periodReturns,
} from "./metrics";
import type { Trade } from "../types/result";

const trade = (pnl: number): Trade => ({
  entryTime: 0,
  exitTime: 1,
  entryPrice: 100,
  exitPrice: 100 + pnl,
  pnl,
});

describe("maxDrawdown", () => {
  it("단조 상승 → MDD 0", () => {
    expect(maxDrawdown([100, 110, 120, 130])).toBe(0);
  });
  it("고점 100 → 저점 50 → MDD 0.5", () => {
    expect(maxDrawdown([100, 50, 80])).toBeCloseTo(0.5, 10);
  });
  it("여러 골 중 가장 깊은 낙폭을 잡는다", () => {
    // peak 200 → 100 = 0.5
    expect(maxDrawdown([100, 90, 200, 100, 150])).toBeCloseTo(0.5, 10);
  });
  it("빈/단일 배열 → 0", () => {
    expect(maxDrawdown([])).toBe(0);
    expect(maxDrawdown([100])).toBe(0);
  });
});

describe("annualizedSharpe", () => {
  it("변동성 0(일정 수익률) → 0 반환(0 나눗셈 방지)", () => {
    expect(annualizedSharpe([0.01, 0.01, 0.01])).toBe(0);
  });
  it("수익률 표본 부족(<2) → 0", () => {
    expect(annualizedSharpe([0.01])).toBe(0);
    expect(annualizedSharpe([])).toBe(0);
  });
  it("양의 평균·정상 변동성 → 양수 샤프", () => {
    const s = annualizedSharpe([0.01, -0.005, 0.02, 0.0, 0.015]);
    expect(s).toBeGreaterThan(0);
  });
  it("알려진 입력 검산: r=[0.01,0.03], mean0.02 std0.01414, √252", () => {
    const s = annualizedSharpe([0.01, 0.03], 252);
    // (0.02/0.0141421356) * sqrt(252) ≈ 1.41421356 * 15.8745 ≈ 22.45
    expect(s).toBeCloseTo((0.02 / Math.sqrt(0.0002)) * Math.sqrt(252), 6);
  });
});

describe("periodReturns", () => {
  it("연속 비율 수익률", () => {
    const r = periodReturns([100, 110, 99]);
    expect(r[0]).toBeCloseTo(0.1, 10);
    expect(r[1]).toBeCloseTo(-0.1, 10);
  });
  it("0 시작값 방어 → 0", () => {
    expect(periodReturns([0, 100])).toEqual([0]);
  });
});

describe("computeMetrics", () => {
  it("totalReturn = last/first - 1", () => {
    const m = computeMetrics([100, 120], []);
    expect(m.totalReturn).toBeCloseTo(0.2, 10);
  });
  it("승률·거래수", () => {
    const m = computeMetrics([100, 110], [trade(5), trade(-3), trade(2), trade(-1)]);
    expect(m.tradeCount).toBe(4);
    expect(m.winRate).toBeCloseTo(0.5, 10);
  });
  it("거래 없으면 승률 0", () => {
    const m = computeMetrics([100, 110], []);
    expect(m.winRate).toBe(0);
    expect(m.tradeCount).toBe(0);
  });
  it("빈 equityCurve → 모두 0", () => {
    const m = computeMetrics([], []);
    expect(m.totalReturn).toBe(0);
    expect(m.sharpe).toBe(0);
    expect(m.maxDrawdown).toBe(0);
  });
});
