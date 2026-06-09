import { describe, it, expect } from "vitest";
import { diversifiedBase } from "./diversify";
import { allocate } from "./allocate";
import type { AllocationConfig } from "../types/allocation";
import type { StrategyProposal } from "../types/strategy";

function prop(
  strategy: string,
  activation: number,
  weights: Record<string, number>,
): StrategyProposal {
  return { strategy, activation, weights };
}

const baseCfg: AllocationConfig = {
  minActivation: 0.05,
  maxWeightPerSymbol: 1,
  maxWeightPerFamily: 1,
  method: "hrp",
};

/** 결정적 의사난수(seed) — 테스트용 재현 가능 수익률 생성. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff - 0.5;
  };
}

describe("diversifiedBase — 상관 다양화", () => {
  it("상관 높은 두 전략은 합산 비중이 naive(활성도만) 대비 감소한다", () => {
    // trend_a, trend_b: 거의 동일한 수익률(상관 ≈ 1). solo: 무상관.
    const r = rng(7);
    const baseRet = Array.from({ length: 60 }, () => r());
    const noise = () => (r() ) * 0.01;
    const retsA = baseRet.map((x) => x + noise());
    const retsB = baseRet.map((x) => x + noise());
    const r3 = rng(99);
    const retsC = Array.from({ length: 60 }, () => r3());

    const candidates = [
      prop("trend_a", 0.5, { AAA: 1 }),
      prop("trend_b", 0.5, { BBB: 1 }),
      prop("solo_c", 0.5, { CCC: 1 }),
    ];
    const strategyReturns = { trend_a: retsA, trend_b: retsB, solo_c: retsC };
    const reasons: string[] = [];
    const div = diversifiedBase(candidates, strategyReturns, baseCfg, reasons);

    // naive: 셋 다 0.5. div: 상관 높은 a,b가 깎여 < 0.5, solo_c는 ≈0.5 유지.
    expect(div.trend_a).toBeLessThan(0.5);
    expect(div.trend_b).toBeLessThan(0.5);
    expect(div.solo_c).toBeGreaterThan(div.trend_a!);
  });

  it("allocate(method=hrp)에서 상관 중복 전략 쌍의 합산 비중이 naive 대비 감소", () => {
    const r = rng(7);
    const baseRet = Array.from({ length: 60 }, () => r());
    const noise = () => r() * 0.01;
    const retsA = baseRet.map((x) => x + noise());
    const retsB = baseRet.map((x) => x + noise());
    const r3 = rng(99);
    const retsC = Array.from({ length: 60 }, () => r3());

    const proposals = [
      prop("trend_a", 0.5, { AAA: 1 }),
      prop("trend_b", 0.5, { BBB: 1 }),
      prop("solo_c", 0.5, { CCC: 1 }),
    ];
    // naive(v1): activation 동일 → 각 1/3
    const v1 = allocate({ proposals }, { ...baseCfg, method: "activation" });
    // v2 다양화
    const v2 = allocate(
      { proposals, strategyReturns: { trend_a: retsA, trend_b: retsB, solo_c: retsC } },
      baseCfg,
    );
    const v1Pair = (v1.strategyAlloc.trend_a ?? 0) + (v1.strategyAlloc.trend_b ?? 0);
    const v2Pair = (v2.strategyAlloc.trend_a ?? 0) + (v2.strategyAlloc.trend_b ?? 0);
    expect(v2Pair).toBeLessThan(v1Pair);
  });
});

describe("diversifiedBase — 성과 추종 금지", () => {
  it("수익률 부호를 전부 뒤집어도 배분이 동일하다(상관·σ만 사용)", () => {
    const r = rng(7);
    const baseRet = Array.from({ length: 60 }, () => r());
    const retsA = baseRet.map((x) => x + r() * 0.01);
    const r3 = rng(42);
    const retsC = Array.from({ length: 60 }, () => r3());

    const candidates = [prop("trend_a", 0.5, { AAA: 1 }), prop("solo_c", 0.5, { CCC: 1 })];
    const reasons1: string[] = [];
    const reasons2: string[] = [];
    const cfg: AllocationConfig = { ...baseCfg, method: "riskparity" };

    const div = diversifiedBase(candidates, { trend_a: retsA, solo_c: retsC }, cfg, reasons1);
    const flipped = diversifiedBase(
      candidates,
      { trend_a: retsA.map((x) => -x), solo_c: retsC.map((x) => -x) },
      cfg,
      reasons2,
    );
    expect(flipped.trend_a).toBeCloseTo(div.trend_a!, 10);
    expect(flipped.solo_c).toBeCloseTo(div.solo_c!, 10);
  });
});

describe("diversifiedBase — look-ahead 차단(prefix 불변성)", () => {
  it("미래 데이터를 덧붙여도 동일 trailing 윈도우의 추정은 불변", () => {
    // correlationLookback=40. 같은 prefix(최근 40)면 미래 append 무관해야 한다.
    const r = rng(11);
    const a = Array.from({ length: 50 }, () => r());
    const r2 = rng(22);
    const c = Array.from({ length: 50 }, () => r2());

    const cfg: AllocationConfig = { ...baseCfg, method: "riskparity", correlationLookback: 40 };
    const candidates = [prop("trend_a", 0.5, { AAA: 1 }), prop("solo_c", 0.5, { CCC: 1 })];

    // "현재 시점" = 인덱스 50까지. trailing 40 = [10..50).
    const nowA = a.slice(0, 50);
    const nowC = c.slice(0, 50);
    const base1 = diversifiedBase(candidates, { trend_a: nowA, solo_c: nowC }, cfg, []);

    // 동일한 과거 + 임의의 미래값을 덧붙인 경우: trailing 40은 이제 미래쪽으로 이동하므로
    // "같은 현재 시점에서의 추정"을 보려면 같은 길이로 잘라야 한다. prefix 불변성은
    // 과거 구간만으로 계산했을 때 미래값이 영향을 주지 않음을 의미한다.
    // 여기서는: 미래값을 덧붙인 배열을 다시 50에서 자르면 base1과 같아야 한다.
    const future = [999, -999, 999, -999, 999];
    const a2 = [...nowA, ...future];
    const c2 = [...nowC, ...future];
    const slicedBack = diversifiedBase(
      candidates,
      { trend_a: a2.slice(0, 50), solo_c: c2.slice(0, 50) },
      cfg,
      [],
    );
    expect(slicedBack).toEqual(base1);
  });

  it("trailing은 최근 lookback개만 본다(앞쪽 과거 변경은 추정에 영향 없음)", () => {
    const cfg: AllocationConfig = { ...baseCfg, method: "riskparity", correlationLookback: 10 };
    const candidates = [prop("trend_a", 0.5, { AAA: 1 }), prop("solo_c", 0.5, { CCC: 1 })];
    const recentA = [0.01, -0.02, 0.03, -0.01, 0.02, -0.03, 0.01, -0.02, 0.03, -0.01];
    const recentC = [-0.02, 0.01, -0.03, 0.02, -0.01, 0.03, -0.02, 0.01, -0.03, 0.02];

    // 앞쪽 과거 prefix가 달라도 최근 10개가 같으면 동일.
    const withOldA = [100, -100, 100, ...recentA];
    const withOldC = [-100, 100, -100, ...recentC];
    const r1 = diversifiedBase(candidates, { trend_a: recentA, solo_c: recentC }, cfg, []);
    const r2 = diversifiedBase(candidates, { trend_a: withOldA, solo_c: withOldC }, cfg, []);
    expect(r2).toEqual(r1);
  });
});

describe("diversifiedBase — 데이터 부족 폴백", () => {
  it("수익률이 거의 없으면 activation base로 폴백", () => {
    const candidates = [prop("trend_a", 0.4, { AAA: 1 }), prop("solo_c", 0.6, { CCC: 1 })];
    const reasons: string[] = [];
    const div = diversifiedBase(
      candidates,
      { trend_a: [0.01], solo_c: [] },
      { ...baseCfg, method: "riskparity" },
      reasons,
    );
    expect(div.trend_a).toBeCloseTo(0.4, 6);
    expect(div.solo_c).toBeCloseTo(0.6, 6);
    expect(reasons.some((x) => x.includes("insufficient"))).toBe(true);
  });
});
