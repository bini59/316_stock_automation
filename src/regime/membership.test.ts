import { describe, it, expect } from "vitest";
import { DEFAULT_REGIME_PARAMS } from "./classifier";
import {
  computeTrend,
  computeVolatility,
  computeMembership,
  computeConfidence,
  argmaxLabel,
  type MembershipParams,
} from "./membership";

const P: MembershipParams = DEFAULT_REGIME_PARAMS;

function sumMembership(m: Record<string, number>): number {
  return Object.values(m).reduce((a, b) => a + b, 0);
}

describe("computeTrend", () => {
  it("양의 z → 양의 trend, -1..+1 범위", () => {
    const t = computeTrend(2, 2, P);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(1);
  });
  it("음의 z → 음의 trend", () => {
    expect(computeTrend(-2, -2, P)).toBeLessThan(0);
  });
  it("z 없으면 0", () => {
    expect(computeTrend(undefined, undefined, P)).toBe(0);
  });
  it("한쪽만 있어도 계산", () => {
    expect(computeTrend(3, undefined, P)).toBeGreaterThan(0);
  });
});

describe("computeVolatility", () => {
  it("성분 가중합, 0..1", () => {
    const v = computeVolatility(0.9, 0.9, 0.9);
    expect(v).toBeCloseTo(0.9, 6);
  });
  it("일부 누락 시 가용 성분으로 재정규화", () => {
    expect(computeVolatility(0.5, undefined, undefined)).toBeCloseTo(0.5, 6);
  });
  it("전부 누락 → 0", () => {
    expect(computeVolatility(undefined, undefined, undefined)).toBe(0);
  });
});

describe("computeMembership 합=1 + 시나리오", () => {
  it("항상 합=1", () => {
    for (const trend of [-1, -0.5, 0, 0.5, 1]) {
      for (const vol of [0, 0.3, 0.6, 0.9]) {
        for (const er of [0, 0.5, 1]) {
          const m = computeMembership({ trend, volatility: vol, trendQuality: er }, P);
          expect(sumMembership(m)).toBeCloseTo(1, 9);
          for (const v of Object.values(m)) expect(v).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("깨끗한 상승(trend+, vol↓, ER↑) → bull 최대", () => {
    const m = computeMembership({ trend: 0.9, volatility: 0.1, trendQuality: 0.95 }, P);
    expect(argmaxLabel(m)).toBe("bull");
    expect(m.bull).toBeGreaterThan(0.5);
  });

  it("고변동 패닉(vol>0.8) → crisis 점화", () => {
    const m = computeMembership({ trend: -0.5, volatility: 0.9, trendQuality: 0.5 }, P);
    expect(argmaxLabel(m)).toBe("crisis");
    expect(m.crisis).toBeGreaterThan(0.5);
  });

  it("완만한 하락(trend-, vol 중간) → bear", () => {
    const m = computeMembership({ trend: -0.7, volatility: 0.4, trendQuality: 0.6 }, P);
    expect(argmaxLabel(m)).toBe("bear");
  });

  it("방향 약함 + ER 낮음 → chop", () => {
    const m = computeMembership({ trend: 0.05, volatility: 0.3, trendQuality: 0.1 }, P);
    expect(argmaxLabel(m)).toBe("chop");
  });
});

describe("computeConfidence", () => {
  it("한 곳 집중 → 높음", () => {
    const c = computeConfidence({ bull: 0.97, bear: 0.01, chop: 0.01, crisis: 0.01 });
    expect(c).toBeGreaterThan(0.7);
  });
  it("균등 → 0 근처", () => {
    const c = computeConfidence({ bull: 0.25, bear: 0.25, chop: 0.25, crisis: 0.25 });
    expect(c).toBeCloseTo(0, 6);
  });
});

describe("argmaxLabel", () => {
  it("최대 멤버십 라벨 반환", () => {
    expect(argmaxLabel({ bull: 0.1, bear: 0.6, chop: 0.2, crisis: 0.1 })).toBe("bear");
  });
});
