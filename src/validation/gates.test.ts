import { describe, it, expect } from "vitest";
import { evaluateGate, adjustCriteriaForTries, evaluateGateWithTries } from "./gates";
import type { Metrics } from "../types/result";
import type { GateCriteria } from "../types/gate";

const metrics = (over: Partial<Metrics> = {}): Metrics => ({
  totalReturn: 0.3,
  sharpe: 1.5,
  maxDrawdown: 0.2,
  winRate: 0.55,
  tradeCount: 50,
  ...over,
});

const criteria: GateCriteria = { minSharpe: 1.0, maxDrawdown: 0.3, minTradeCount: 30 };

describe("evaluateGate", () => {
  it("모든 기준 충족 → passed", () => {
    expect(evaluateGate(metrics(), criteria).passed).toBe(true);
  });
  it("샤프 미달 → 실패 + 사유", () => {
    const r = evaluateGate(metrics({ sharpe: 0.5 }), criteria);
    expect(r.passed).toBe(false);
    expect(r.reasons.some((x) => x.includes("Sharpe"))).toBe(true);
  });
  it("MDD 초과 → 실패 + 사유", () => {
    const r = evaluateGate(metrics({ maxDrawdown: 0.5 }), criteria);
    expect(r.passed).toBe(false);
    expect(r.reasons.some((x) => x.includes("MDD"))).toBe(true);
  });
  it("표본 부족 → 실패 + 사유", () => {
    const r = evaluateGate(metrics({ tradeCount: 5 }), criteria);
    expect(r.passed).toBe(false);
    expect(r.reasons.some((x) => x.includes("표본"))).toBe(true);
  });
  it("복수 실패 사유 동시 기록", () => {
    const r = evaluateGate(metrics({ sharpe: 0.1, tradeCount: 1 }), criteria);
    expect(r.reasons.length).toBe(2);
  });
});

describe("다중검정 보정", () => {
  it("triesIndex<=1 → 보정 없음", () => {
    expect(adjustCriteriaForTries(criteria, 1).minSharpe).toBeCloseTo(1.0, 10);
  });
  it("시도 2배마다 minSharpe 상향 (log2)", () => {
    // tries=4 → log2(4)=2 → +0.2
    expect(adjustCriteriaForTries(criteria, 4, 0.1).minSharpe).toBeCloseTo(1.2, 10);
  });
  it("많이 시도하면 같은 샤프라도 게이트 탈락 가능", () => {
    const m = metrics({ sharpe: 1.1 });
    expect(evaluateGateWithTries(m, criteria, 1).passed).toBe(true);
    // tries=64 → +0.6 → minSharpe 1.6 > 1.1
    expect(evaluateGateWithTries(m, criteria, 64, 0.1).passed).toBe(false);
  });
});
