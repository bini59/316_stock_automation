import { describe, it, expect } from "vitest";
import { runPool, activationOf, ACTIVATION_EPS } from "./pool";
import type { RegimeStrategy, UniverseHistory } from "../types/strategy";
import { regimeState, seriesFromCloses, rising } from "./_testutil";

/** 고정 비중을 반환하는 테스트용 전략. */
function fakeStrategy(
  name: string,
  affinity: RegimeStrategy["regimeAffinity"],
  weights: Record<string, number>,
): RegimeStrategy {
  return {
    name,
    family: "trend",
    regimeAffinity: affinity,
    params: {},
    propose: () => ({ ...weights }),
  };
}

const universe: UniverseHistory = { AAA: seriesFromCloses(rising(10)) };

describe("activationOf", () => {
  it("내적 검산: membership·affinity", () => {
    // 문서 예시: membership {bull:0.7, chop:0.3} × affinity {bull:1.0, chop:0.3} = 0.79
    const m = { bull: 0.7, bear: 0, chop: 0.3, crisis: 0 };
    expect(activationOf(m, { bull: 1.0, chop: 0.3 })).toBeCloseTo(0.79, 10);
  });
  it("affinity에 없는 라벨은 무시", () => {
    const m = { bull: 0.5, bear: 0.5, chop: 0, crisis: 0 };
    expect(activationOf(m, { bull: 1.0 })).toBeCloseTo(0.5, 10);
  });
  it("교집합 없으면 0", () => {
    const m = { bull: 0, bear: 0, chop: 0, crisis: 1 };
    expect(activationOf(m, { bull: 1.0, chop: 0.3 })).toBe(0);
  });
});

describe("runPool", () => {
  it("활성 전략만 제안, 활성도 태그", () => {
    const strat = fakeStrategy("s", { bull: 1.0 }, { AAA: 0.5 });
    const out = runPool([strat], universe, regimeState({ bull: 0.8 }));
    expect(out).toHaveLength(1);
    expect(out[0]!.strategy).toBe("s");
    expect(out[0]!.activation).toBeCloseTo(0.8, 10);
    expect(out[0]!.weights).toEqual({ AAA: 0.5 });
  });

  it("activation < EPS면 제외(propose 호출 안 함)", () => {
    let called = false;
    const strat: RegimeStrategy = {
      name: "lazy",
      family: "meanrev",
      regimeAffinity: { chop: 1.0 },
      params: {},
      propose: () => {
        called = true;
        return { AAA: 1 };
      },
    };
    // chop 멤버십 0 → activation 0 < EPS
    const out = runPool([strat], universe, regimeState({ bull: 1 }));
    expect(out).toHaveLength(0);
    expect(called).toBe(false);
  });

  it("EPS 경계: 정확히 EPS면 포함", () => {
    const strat = fakeStrategy("edge", { bull: 1.0 }, { AAA: 0.3 });
    const out = runPool([strat], universe, regimeState({ bull: ACTIVATION_EPS }));
    expect(out).toHaveLength(1);
  });

  it("weights 합 ≤ 1로 캡(초과 시 비례 축소)", () => {
    const strat = fakeStrategy("over", { bull: 1.0 }, { AAA: 0.8, BBB: 0.8 });
    const out = runPool([strat], universe, regimeState({ bull: 1 }));
    const sum = Object.values(out[0]!.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("음수·비유한 비중 제거", () => {
    const strat = fakeStrategy("bad", { bull: 1.0 }, {
      AAA: -0.5,
      BBB: 0.3,
      CCC: NaN,
    });
    const out = runPool([strat], universe, regimeState({ bull: 1 }));
    expect(out[0]!.weights).toEqual({ BBB: 0.3 });
  });

  it("합 ≤ 1이면 현금 보존(스케일업 안 함)", () => {
    const strat = fakeStrategy("under", { bull: 1.0 }, { AAA: 0.3 });
    const out = runPool([strat], universe, regimeState({ bull: 1 }));
    expect(out[0]!.weights).toEqual({ AAA: 0.3 });
  });
});
