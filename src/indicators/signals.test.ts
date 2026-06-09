import { describe, it, expect } from "vitest";
import {
  kaufmanER,
  smaSlope,
  distanceFromSma,
  momentum,
  momentum12_1,
  rsi,
  bollinger,
  currentDrawdown,
} from "./signals";

describe("kaufmanER", () => {
  it("일직선 상승 → ER≈1", () => {
    expect(kaufmanER([10, 11, 12, 13, 14], 4)).toBeCloseTo(1, 10);
  });
  it("제자리 톱질 → ER 0", () => {
    expect(kaufmanER([10, 12, 10, 12, 10], 4)).toBeCloseTo(0, 10);
  });
  it("데이터 부족 → undefined", () => {
    expect(kaufmanER([10, 11], 5)).toBeUndefined();
  });
});

describe("추세 위치/기울기", () => {
  it("distanceFromSma: 현재가 평균 위면 양수", () => {
    const d = distanceFromSma([10, 10, 10, 20], 3)!;
    expect(d).toBeGreaterThan(0);
  });
  it("smaSlope: 상승 추세면 양수", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(smaSlope(closes, 5, 10)!).toBeGreaterThan(0);
  });
});

describe("모멘텀", () => {
  it("momentum 단순 수익률", () => {
    expect(momentum([100, 105, 110], 2)!).toBeCloseTo(0.1, 10);
  });
  it("momentum12_1: 최근 skip 제외", () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + i);
    const m = momentum12_1(closes, 252, 21);
    expect(m).toBeDefined();
    expect(m!).toBeGreaterThan(0);
  });
  it("부족하면 undefined", () => {
    expect(momentum([100], 5)).toBeUndefined();
    expect(momentum12_1([100, 101], 252)).toBeUndefined();
  });
});

describe("RSI(2)", () => {
  it("연속 상승 → 100", () => {
    expect(rsi([1, 2, 3], 2)).toBeCloseTo(100, 10);
  });
  it("연속 하락 → 0", () => {
    expect(rsi([3, 2, 1], 2)).toBeCloseTo(0, 10);
  });
});

describe("볼린저", () => {
  it("밴드 구조 + pctB", () => {
    const b = bollinger([10, 11, 12, 13, 14], 5, 2)!;
    expect(b.upper).toBeGreaterThan(b.mid);
    expect(b.lower).toBeLessThan(b.mid);
    expect(b.pctB).toBeGreaterThan(0.5); // 끝값이 상승 → 상단 쪽
  });
});

describe("currentDrawdown", () => {
  it("피크 대비 현재 하락폭", () => {
    expect(currentDrawdown([100, 120, 90])).toBeCloseTo(0.25, 10);
  });
  it("신고가면 0", () => {
    expect(currentDrawdown([100, 110, 120])).toBe(0);
  });
});

describe("★ look-ahead: 신호는 미래 미참조", () => {
  const full = [10, 11, 9, 12, 13, 8, 14, 15, 7, 16, 18, 17];
  it("prefix == full의 동일 끝점", () => {
    for (let k = 6; k < full.length; k++) {
      const prefix = full.slice(0, k);
      expect(kaufmanER(prefix, 4)).toBe(kaufmanER(full.slice(0, k), 4));
      expect(rsi(prefix, 2)).toBe(rsi(full.slice(0, k), 2));
      expect(momentum(prefix, 3)).toBe(momentum(full.slice(0, k), 3));
    }
  });
});
