import { describe, it, expect } from "vitest";
import { generateWindows, walkForwardAnalyze } from "./walkForward";
import type { Bar, PriceSeries } from "../types/market";
import type { Metrics } from "../types/result";

const series = (n: number): PriceSeries =>
  Array.from({ length: n }, (_, i): Bar => ({
    timestamp: i + 1,
    open: 100,
    high: 100,
    low: 100,
    close: 100 + i,
    volume: 1,
  }));

describe("generateWindows", () => {
  it("비중복 rolling 창 생성", () => {
    // length 30, train 10, test 5, step 5 → starts 0,5,10,15 (start+15<=30)
    const ws = generateWindows(30, 10, 5, 5);
    expect(ws.length).toBe(4);
    expect(ws[0]).toEqual({ trainStart: 0, trainEnd: 10, testStart: 10, testEnd: 15 });
    expect(ws[1]!.trainStart).toBe(5);
  });

  it("★ test 구간은 항상 train 이후(미래만 검증, 누수 없음)", () => {
    const ws = generateWindows(50, 20, 10);
    for (const w of ws) {
      expect(w.testStart).toBeGreaterThanOrEqual(w.trainEnd);
      expect(w.testEnd).toBeLessThanOrEqual(50);
      expect(w.trainStart).toBeLessThan(w.trainEnd);
    }
  });

  it("창이 전체 길이를 넘지 않는다", () => {
    const ws = generateWindows(12, 10, 5);
    expect(ws.length).toBe(0); // 10+5=15 > 12
  });

  it("잘못된 크기는 예외", () => {
    expect(() => generateWindows(100, 0, 5)).toThrow();
    expect(() => generateWindows(100, 10, 0)).toThrow();
  });
});

describe("walkForwardAnalyze", () => {
  it("각 창마다 evaluate 호출, 일관성 집계", () => {
    const metric = (tr: number, sh: number): Metrics => ({
      totalReturn: tr,
      sharpe: sh,
      maxDrawdown: 0.1,
      winRate: 0.5,
      tradeCount: 10,
    });
    const seq = [metric(0.1, 1), metric(-0.05, -0.5), metric(0.2, 1.5)];
    let call = 0;
    const r = walkForwardAnalyze(series(45), { trainSize: 10, testSize: 5 }, (train, test) => {
      // train/test 슬라이스가 비어있지 않고 연속
      expect(train.length).toBe(10);
      expect(test.length).toBe(5);
      expect(test[0]!.timestamp).toBeGreaterThan(train[train.length - 1]!.timestamp);
      return seq[call++ % seq.length]!;
    });
    expect(r.consistency.windowCount).toBe(r.windows.length);
    expect(r.consistency.positiveRate).toBeGreaterThan(0);
    expect(r.consistency.positiveRate).toBeLessThanOrEqual(1);
  });

  it("창이 없으면 일관성 0", () => {
    const r = walkForwardAnalyze(series(5), { trainSize: 10, testSize: 5 }, () => ({
      totalReturn: 1,
      sharpe: 1,
      maxDrawdown: 0,
      winRate: 1,
      tradeCount: 1,
    }));
    expect(r.consistency.windowCount).toBe(0);
    expect(r.consistency.positiveRate).toBe(0);
  });
});
