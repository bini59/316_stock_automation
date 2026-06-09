import { describe, it, expect } from "vitest";
import type { Bar, PriceSeries } from "../types/market";
import {
  termStress,
  vixPercentile,
  rollingRvPercentile,
  computeRawSignals,
} from "./signals";

function bars(closes: number[]): PriceSeries {
  return closes.map(
    (c, i): Bar => ({
      timestamp: i * 86_400_000,
      open: c,
      high: c,
      low: c,
      close: c,
      volume: 0,
    }),
  );
}

describe("termStress", () => {
  it("평시 콘탱고(VIX<VIX3M) → 0", () => {
    expect(termStress(bars([15]), bars([18]))).toBe(0);
  });
  it("역전(VIX>VIX3M) → 양수, 강한 역전은 1로 포화", () => {
    // VIX/VIX3M-1 = 0.1 → /0.3 ≈ 0.333
    expect(termStress(bars([22]), bars([20]))).toBeCloseTo(0.1 / 0.3, 6);
    // 큰 역전: 0.5 → clamp 0.3 → 1
    expect(termStress(bars([30]), bars([20]))).toBeCloseTo(1, 6);
  });
  it("마지막(현재) 바만 본다", () => {
    expect(termStress(bars([99, 99, 15]), bars([1, 1, 18]))).toBe(0);
  });
  it("입력 없으면 undefined", () => {
    expect(termStress(undefined, bars([18]))).toBeUndefined();
    expect(termStress(bars([15]), undefined)).toBeUndefined();
  });
});

describe("vixPercentile", () => {
  it("현재가 분포 최고치면 1에 근접", () => {
    const v = vixPercentile(bars([10, 12, 14, 16, 50]), 378)!;
    expect(v).toBeCloseTo(1, 6);
  });
  it("현재가 분포 최저치면 낮음", () => {
    const v = vixPercentile(bars([50, 40, 30, 20, 5]), 378)!;
    expect(v).toBeLessThan(0.3);
  });
});

describe("rollingRvPercentile", () => {
  it("변동성 급증 시 현재 rv 백분위가 높다", () => {
    const calm = Array.from({ length: 60 }, (_, i) => 100 + i * 0.01);
    const spike = [100, 90, 110, 85, 115, 80, 120];
    const closes = [...calm, ...spike];
    const pct = rollingRvPercentile(closes, 20, 378)!;
    expect(pct).toBeGreaterThan(0.8);
  });
});

describe("computeRawSignals look-ahead", () => {
  const closes = Array.from({ length: 260 }, (_, i) => 100 + i);
  const full = bars(closes);
  const params = {
    smaWindow: 200,
    slopeLookback: 20,
    erWindow: 30,
    rvWindow: 20,
    pctLookback: 378,
  };
  it("prefix 신호는 미래 바 유무와 무관", () => {
    const k = 230;
    const a = computeRawSignals(full.slice(0, k), undefined, params);
    const b = computeRawSignals(full, undefined, params);
    // prefix(k) 결과는 full을 k에서 자른 것과 같아야 한다.
    const a2 = computeRawSignals(full.slice(0, k), undefined, params);
    expect(a).toEqual(a2);
    // 우상향 일직선이면 ER≈1
    expect(a.er!).toBeCloseTo(1, 6);
    expect(b.er!).toBeCloseTo(1, 6);
  });
});
