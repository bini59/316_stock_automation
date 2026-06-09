import { describe, it, expect } from "vitest";
import { LowVolTilt, DefensiveSectorRotation, CashRaise } from "./defensive";
import { sumWeights } from "./weights";
import type { UniverseHistory } from "../types/strategy";
import { regimeState, seriesFromCloses, rising, choppy } from "./_testutil";

const bear = regimeState({ bear: 1 }, "bear");

function uni(spec: Record<string, number[]>): UniverseHistory {
  const out: Record<string, ReturnType<typeof seriesFromCloses>> = {};
  for (const [s, closes] of Object.entries(spec)) out[s] = seriesFromCloses(closes);
  return out;
}

describe("LowVolTilt", () => {
  it("저변동 종목에 더 큰 비중", () => {
    const u = uni({
      CALM: rising(60, 100, 0.1), // 저변동
      WILD: choppy(60, 100, 30), // 고변동
    });
    const w = new LowVolTilt({ bottomQuantile: 1, grossCap: 1 }).propose(u, bear);
    expect(w.CALM!).toBeGreaterThan(w.WILD ?? 0);
  });

  it("grossCap으로 현금 보존(합 ≤ cap)", () => {
    const u = uni({ A: rising(60, 100, 0.2), B: rising(60, 100, 0.3) });
    const w = new LowVolTilt({ grossCap: 0.6 }).propose(u, bear);
    expect(sumWeights(w)).toBeLessThanOrEqual(0.6 + 1e-9);
  });

  it("변동성 산출 불가하면 빈 비중", () => {
    const w = new LowVolTilt().propose(uni({ A: rising(5) }), bear);
    expect(w).toEqual({});
  });
});

describe("DefensiveSectorRotation", () => {
  it("유니버스의 방어섹터(XLP/XLU/XLV)만 보유", () => {
    const u = uni({
      XLK: rising(30),
      XLP: rising(30),
      XLU: rising(30),
      XLE: rising(30),
    });
    const w = new DefensiveSectorRotation({ grossCap: 1 }).propose(u, bear);
    expect(Object.keys(w).sort()).toEqual(["XLP", "XLU"]);
  });

  it("방어섹터 없으면 전량 현금", () => {
    const w = new DefensiveSectorRotation().propose(uni({ XLK: rising(30) }), bear);
    expect(w).toEqual({});
  });
});

describe("CashRaise", () => {
  it("baseGross로 합 축소(현금 비중 확대)", () => {
    const u = uni({ A: rising(30), B: rising(30), C: rising(30) });
    const w = new CashRaise({ baseGross: 0.5, minGross: 0.1 }).propose(u, bear);
    expect(sumWeights(w)).toBeCloseTo(0.5, 6);
  });

  it("crisis 멤버십이 강하면 gross를 minGross로 더 축소", () => {
    const u = uni({ A: rising(30), B: rising(30) });
    const crisisState = regimeState({ bear: 0.3, crisis: 0.7 }, "crisis");
    const w = new CashRaise({ baseGross: 0.5, minGross: 0.1 }).propose(u, crisisState);
    // gross = 0.5 - (0.5-0.1)*0.7 = 0.22
    expect(sumWeights(w)).toBeCloseTo(0.22, 6);
  });

  it("빈 유니버스면 빈 비중", () => {
    expect(new CashRaise().propose({}, bear)).toEqual({});
  });
});

describe("★ look-ahead: prefix 불변성", () => {
  it("LowVolTilt(prefix)가 미래 미참조", () => {
    const a = seriesFromCloses(rising(120, 100, 0.5));
    const b = seriesFromCloses(choppy(120, 100, 10));
    const cut = 80;
    const strat = new LowVolTilt();
    const fromPrefix = strat.propose({ A: a.slice(0, cut), B: b.slice(0, cut) }, bear);
    const again = strat.propose({ A: a.slice(0, cut), B: b.slice(0, cut) }, bear);
    expect(fromPrefix).toEqual(again);
  });
});
