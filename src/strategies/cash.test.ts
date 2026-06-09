import { describe, it, expect } from "vitest";
import { AllCash } from "./cash";
import { runPool } from "./pool";
import type { UniverseHistory } from "../types/strategy";
import { regimeState, seriesFromCloses, rising } from "./_testutil";

const universe: UniverseHistory = { AAA: seriesFromCloses(rising(10)) };

describe("AllCash", () => {
  it("항상 빈 비중(전량 현금)", () => {
    const c = new AllCash();
    expect(c.propose(universe, regimeState({ crisis: 1 }, "crisis"))).toEqual({});
    expect(c.propose(universe, regimeState({ bull: 1 }))).toEqual({});
  });

  it("affinity crisis 1.0 → crisis에서만 활성", () => {
    const c = new AllCash();
    const inCrisis = runPool([c], universe, regimeState({ crisis: 1 }, "crisis"));
    expect(inCrisis).toHaveLength(1);
    expect(inCrisis[0]!.activation).toBeCloseTo(1, 10);
    expect(inCrisis[0]!.weights).toEqual({});

    const inBull = runPool([c], universe, regimeState({ bull: 1 }));
    expect(inBull).toHaveLength(0); // bull에선 비활성
  });
});
