import { describe, it, expect } from "vitest";
import { allocate, familyOf } from "./allocate";
import type { AllocationConfig } from "../types/allocation";
import type { StrategyProposal } from "../types/strategy";

const cfg: AllocationConfig = {
  minActivation: 0.05,
  maxWeightPerSymbol: 0.15,
  maxWeightPerFamily: 0.5,
  method: "activation",
};

function prop(
  strategy: string,
  activation: number,
  weights: Record<string, number>,
): StrategyProposal {
  return { strategy, activation, weights };
}

function sum(w: Readonly<Record<string, number>>): number {
  return Object.values(w).reduce((a, b) => a + b, 0);
}

describe("familyOf", () => {
  it("이름 키워드로 패밀리 추론", () => {
    expect(familyOf("trend_follow")).toBe("trend");
    expect(familyOf("momentum12_1")).toBe("trend");
    expect(familyOf("meanrev_bb")).toBe("meanrev");
    expect(familyOf("reversion")).toBe("meanrev");
    expect(familyOf("defensive_lowvol")).toBe("defensive");
    expect(familyOf("cash_park")).toBe("cash");
    expect(familyOf("unknown_thing")).toBe("trend"); // 보수적 폴백
  });
});

describe("allocate v1 — 패밀리 예산 상한", () => {
  it("같은 family 전략 다수면 합이 maxWeightPerFamily 이내로 축소된다", () => {
    // trend 4개 (각 activation 0.6) → base 합 2.4 > cap 0.5 → 0.5로 축소.
    // meanrev 1개 0.2 (cap 미만, 그대로). 정규화 전 trend 0.5 / meanrev 0.2.
    const proposals = [
      prop("trend_a", 0.6, { AAA: 0.5 }),
      prop("trend_b", 0.6, { BBB: 0.5 }),
      prop("trend_c", 0.6, { CCC: 0.5 }),
      prop("trend_d", 0.6, { DDD: 0.5 }),
      prop("meanrev_x", 0.2, { EEE: 0.5 }),
    ];
    const r = allocate({ proposals }, cfg);
    const trendShare =
      (r.strategyAlloc.trend_a ?? 0) +
      (r.strategyAlloc.trend_b ?? 0) +
      (r.strategyAlloc.trend_c ?? 0) +
      (r.strategyAlloc.trend_d ?? 0);
    // QA H1 수정: 정규화 후 절대 상한 적용 → trend 합 = 정확히 0.5(cap), 차액은 현금.
    // base 합 2.6: trend 각 0.6/2.6, meanrev 0.2/2.6. trend 합 0.923>0.5 → 0.5로 캡.
    expect(trendShare).toBeCloseTo(0.5, 6);
    expect(r.strategyAlloc.meanrev_x).toBeCloseTo(0.2 / 2.6, 4);
    expect(r.reasons).toContain("family trend capped");
    // meanrev는 capped되지 않아야 함
    expect(r.reasons).not.toContain("family meanrev capped");
    // 차액(1 − 0.5 − 0.2/2.6)은 암묵적 현금 → strategyAlloc 합 < 1
    expect(sum(r.strategyAlloc)).toBeCloseTo(0.5 + 0.2 / 2.6, 6);
    expect(sum(r.strategyAlloc)).toBeLessThan(1);
  });

  it("★ QA H1: 책 전체가 한 패밀리여도 cap을 넘지 않는다(재정규화로 무력화 금지)", () => {
    // trend 5개만 활성 → 정규화하면 합 1.0이지만 cap 0.5로 절대 제한, 나머지 현금
    const proposals = [
      prop("trend_a", 0.8, { AAA: 1 }),
      prop("trend_b", 0.8, { BBB: 1 }),
      prop("trend_c", 0.8, { CCC: 1 }),
      prop("trend_d", 0.8, { DDD: 1 }),
      prop("trend_e", 0.8, { EEE: 1 }),
    ];
    const r = allocate({ proposals }, cfg);
    const trendShare = sum(r.strategyAlloc);
    expect(trendShare).toBeCloseTo(0.5, 6); // 전부 trend → 합 = cap
    expect(trendShare).toBeLessThan(1); // 나머지 0.5는 암묵적 현금
  });

  it("패밀리 합이 상한 이하면 축소하지 않는다", () => {
    const proposals = [
      prop("trend_a", 0.2, { AAA: 0.5 }),
      prop("meanrev_x", 0.2, { BBB: 0.5 }),
    ];
    const r = allocate({ proposals }, cfg);
    expect(r.reasons.some((x) => x.includes("family") && x.includes("capped"))).toBe(false);
    expect(r.strategyAlloc.trend_a).toBeCloseTo(0.5, 6);
  });
});

describe("allocate v1 — 종목 집중 상한 & 병합", () => {
  it("한 종목 비중은 maxWeightPerSymbol을 넘지 않는다", () => {
    const proposals = [prop("trend_a", 0.5, { AAA: 1 })];
    const r = allocate({ proposals }, cfg);
    expect(r.weights.AAA).toBeLessThanOrEqual(cfg.maxWeightPerSymbol + 1e-9);
    expect(r.reasons).toContain("symbol concentration capped");
  });

  it("두 전략이 같은 종목(AAPL)을 원하면 합산 병합된다", () => {
    const proposals = [
      prop("trend_a", 0.5, { AAPL: 0.4, MSFT: 0.6 }),
      prop("meanrev_x", 0.5, { AAPL: 0.4, GOOG: 0.6 }),
    ];
    const r = allocate({ proposals }, { ...cfg, maxWeightPerSymbol: 1 });
    // strategyAlloc 각 0.5. AAPL = 0.5*0.4 + 0.5*0.4 = 0.4
    expect(r.weights.AAPL).toBeCloseTo(0.4, 6);
    expect(r.weights.MSFT).toBeCloseTo(0.3, 6);
    expect(r.weights.GOOG).toBeCloseTo(0.3, 6);
  });

  it("Σweights ≤ 1을 항상 만족", () => {
    const proposals = [
      prop("trend_a", 0.9, { AAA: 1 }),
      prop("trend_b", 0.9, { BBB: 1 }),
      prop("meanrev_x", 0.9, { CCC: 1 }),
    ];
    const r = allocate({ proposals }, cfg);
    expect(sum(r.weights)).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe("allocate v1 — 필터/현금화", () => {
  it("minActivation 미만 전략은 제외", () => {
    const proposals = [
      prop("trend_a", 0.5, { AAA: 1 }),
      prop("trend_weak", 0.01, { ZZZ: 1 }),
    ];
    const r = allocate({ proposals }, cfg);
    expect(r.strategyAlloc.trend_weak).toBeUndefined();
    expect(r.weights.ZZZ).toBeUndefined();
  });

  it("빈 proposals → weights={}", () => {
    const r = allocate({ proposals: [] }, cfg);
    expect(r.weights).toEqual({});
    expect(r.strategyAlloc).toEqual({});
  });

  it("전부 현금/저활성 → weights={} (자연 현금화)", () => {
    const proposals = [
      prop("cash_park", 0.02, {}),
      prop("trend_a", 0.01, { AAA: 1 }),
    ];
    const r = allocate({ proposals }, cfg);
    expect(r.weights).toEqual({});
  });

  it("활성 전략이 빈 weights만 제안 → weights={} (현금)", () => {
    const proposals = [prop("cash_park", 0.9, {})];
    const r = allocate({ proposals }, cfg);
    expect(r.weights).toEqual({});
    expect(r.strategyAlloc.cash_park).toBeCloseTo(1, 6);
  });
});

describe("allocate — 순수성", () => {
  it("같은 입력은 같은 출력", () => {
    const proposals = [
      prop("trend_a", 0.5, { AAA: 0.6, BBB: 0.4 }),
      prop("meanrev_x", 0.3, { AAA: 0.5, CCC: 0.5 }),
    ];
    const r1 = allocate({ proposals }, cfg);
    const r2 = allocate({ proposals }, cfg);
    expect(r1).toEqual(r2);
  });

  it("입력 객체를 변형하지 않는다", () => {
    const proposals = [prop("trend_a", 0.5, { AAA: 1 })];
    const snapshot = JSON.stringify(proposals);
    allocate({ proposals }, cfg);
    expect(JSON.stringify(proposals)).toBe(snapshot);
  });
});

describe("allocate — v2 폴백", () => {
  it("method=riskparity인데 strategyReturns 없으면 v1로 폴백", () => {
    const proposals = [
      prop("trend_a", 0.5, { AAA: 1 }),
      prop("meanrev_x", 0.5, { BBB: 1 }),
    ];
    const r = allocate({ proposals }, { ...cfg, method: "riskparity" });
    expect(r.reasons.some((x) => x.includes("v1 fallback"))).toBe(true);
    expect(r.strategyAlloc.trend_a).toBeCloseTo(0.5, 6);
  });
});
