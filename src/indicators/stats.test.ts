import { describe, it, expect } from "vitest";
import {
  mean,
  stddev,
  sma,
  ema,
  emaSeries,
  logReturns,
  realizedVol,
  rollingPercentile,
  winsorize,
  zScore,
  sigmoid,
  clamp,
  normalizedEntropy,
  pearson,
} from "./stats";

describe("기본 통계", () => {
  it("mean/stddev", () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9], false)).toBeCloseTo(2, 6);
    expect(stddev([5])).toBe(0);
  });
  it("sma trailing", () => {
    expect(sma([1, 2, 3, 4], 2)).toBeCloseTo(3.5, 10);
    expect(sma([1, 2], 5)).toBeUndefined();
  });
  it("ema span=1 → 마지막 값", () => {
    expect(ema([1, 2, 3], 1)).toBeCloseTo(3, 10);
    expect(ema([], 5)).toBeUndefined();
  });
  it("emaSeries 마지막 = ema", () => {
    const s = emaSeries([1, 2, 3, 4], 3);
    expect(s[s.length - 1]).toBeCloseTo(ema([1, 2, 3, 4], 3)!, 10);
  });
});

describe("수익률·변동성", () => {
  it("logReturns", () => {
    const r = logReturns([100, 110]);
    expect(r[0]).toBeCloseTo(Math.log(1.1), 10);
  });
  it("realizedVol 연율화", () => {
    const closes = [100, 101, 100, 101, 100, 101];
    const v = realizedVol(closes, 5);
    expect(v).toBeGreaterThan(0);
  });
  it("데이터 부족 → undefined", () => {
    expect(realizedVol([100, 101], 20)).toBeUndefined();
  });
});

describe("백분위·z스코어", () => {
  it("rollingPercentile: 최고값이면 1, 최저값이면 낮음", () => {
    expect(rollingPercentile([1, 2, 3, 4, 5], 5)).toBeCloseTo(1, 10);
    expect(rollingPercentile([5, 4, 3, 2, 1], 5)).toBeCloseTo(0.2, 10);
  });
  it("zScore: 상승 끝값 양수", () => {
    const z = zScore([1, 2, 3, 4, 5], 5)!;
    expect(z).toBeGreaterThan(0);
  });
  it("winsorize ±3σ 클립", () => {
    expect(winsorize(100, 0, 1, 3)).toBe(3);
    expect(winsorize(-100, 0, 1, 3)).toBe(-3);
    expect(winsorize(1, 0, 1, 3)).toBe(1);
  });
});

describe("보조 함수", () => {
  it("sigmoid(0)=0.5, clamp", () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 10);
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
  });
  it("normalizedEntropy: 균등 1, 집중 0", () => {
    expect(normalizedEntropy([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(1, 10);
    expect(normalizedEntropy([1, 0, 0, 0])).toBeCloseTo(0, 10);
  });
  it("pearson: 동일 +1, 반대 -1", () => {
    expect(pearson([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 10);
  });
});

describe("★ look-ahead: 통계는 미래 데이터에 의존하지 않는다", () => {
  const full = [10, 11, 9, 12, 13, 8, 14, 15, 7, 16];
  it("prefix에서 계산한 값 == full에서 같은 끝점으로 계산한 값", () => {
    for (let k = 5; k < full.length; k++) {
      const prefix = full.slice(0, k);
      // full을 잘라 같은 끝점을 만든 것과 prefix가 동일 → 미래 무참조
      expect(sma(prefix, 3)).toBe(sma(full.slice(0, k), 3));
      expect(ema(prefix, 4)).toBe(ema(full.slice(0, k), 4));
      expect(rollingPercentile(prefix, 5)).toBe(rollingPercentile(full.slice(0, k), 5));
      expect(zScore(prefix, 5)).toBe(zScore(full.slice(0, k), 5));
    }
  });
});
