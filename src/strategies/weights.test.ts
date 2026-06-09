import { describe, it, expect } from "vitest";
import {
  equalWeight,
  inverseVolWeight,
  scoreWeight,
  capSum,
  sumWeights,
} from "./weights";

describe("equalWeight", () => {
  it("동일가중 합 = cap", () => {
    const w = equalWeight(["A", "B", "C", "D"]);
    expect(w.A).toBeCloseTo(0.25, 10);
    expect(sumWeights(w)).toBeCloseTo(1, 10);
  });
  it("cap 적용", () => {
    expect(sumWeights(equalWeight(["A", "B"], 0.6))).toBeCloseTo(0.6, 10);
  });
  it("빈 입력 → {}", () => {
    expect(equalWeight([])).toEqual({});
  });
});

describe("inverseVolWeight", () => {
  it("저변동에 더 큰 비중", () => {
    const w = inverseVolWeight({ LOW: 0.1, HIGH: 0.4 });
    expect(w.LOW!).toBeGreaterThan(w.HIGH!);
    expect(sumWeights(w)).toBeCloseTo(1, 10);
  });
  it("vol<=0은 제외", () => {
    const w = inverseVolWeight({ A: 0.2, BAD: 0, NEG: -1 });
    expect(Object.keys(w)).toEqual(["A"]);
  });
  it("유효 없으면 {}", () => {
    expect(inverseVolWeight({ A: 0 })).toEqual({});
  });
});

describe("scoreWeight", () => {
  it("점수 비례, score<=0 제외", () => {
    const w = scoreWeight({ A: 3, B: 1, C: -1 });
    expect(w.A).toBeCloseTo(0.75, 10);
    expect(w.B).toBeCloseTo(0.25, 10);
    expect(w.C).toBeUndefined();
  });
});

describe("capSum", () => {
  it("초과 시 비례 축소", () => {
    const w = capSum({ A: 0.8, B: 0.8 }, 1);
    expect(sumWeights(w)).toBeCloseTo(1, 10);
    expect(w.A).toBeCloseTo(0.5, 10);
  });
  it("미달이면 그대로(현금 보존)", () => {
    expect(capSum({ A: 0.3 }, 1)).toEqual({ A: 0.3 });
  });
});
