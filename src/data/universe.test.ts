import { describe, it, expect } from "vitest";
import {
  StaticUniverse,
  PointInTimeUniverse,
  SECTOR_ETF_UNIVERSE,
  DEFENSIVE_SECTORS,
} from "./universe";

describe("StaticUniverse", () => {
  it("기본값은 섹터 ETF 유니버스", () => {
    const u = new StaticUniverse();
    expect(u.symbolsAt(0)).toEqual(SECTOR_ETF_UNIVERSE);
  });
  it("방어 섹터가 유니버스에 포함", () => {
    for (const s of DEFENSIVE_SECTORS) {
      expect(SECTOR_ETF_UNIVERSE).toContain(s);
    }
  });
});

describe("PointInTimeUniverse — 생존편향 차단", () => {
  const u = new PointInTimeUniverse([
    { effectiveFrom: 1000, members: ["A", "B"] },
    { effectiveFrom: 2000, members: ["A", "B", "C"] },
    { effectiveFrom: 3000, members: ["A", "C", "D"] }, // B 편출, D 편입
  ]);

  it("시점 이전 가장 최근 스냅샷의 구성을 반환", () => {
    expect(u.symbolsAt(1500)).toEqual(["A", "B"]);
    expect(u.symbolsAt(2500)).toEqual(["A", "B", "C"]);
    expect(u.symbolsAt(3500)).toEqual(["A", "C", "D"]);
  });
  it("첫 스냅샷 이전은 빈 구성(존재 안 함)", () => {
    expect(u.symbolsAt(500)).toEqual([]);
  });
  it("편출된 종목은 이후 시점에서 빠진다(미래 구성 누수 없음)", () => {
    expect(u.symbolsAt(3500)).not.toContain("B");
  });
  it("스냅샷 비면 예외", () => {
    expect(() => new PointInTimeUniverse([])).toThrow();
  });
  it("입력 순서 무관(내부 정렬)", () => {
    const shuffled = new PointInTimeUniverse([
      { effectiveFrom: 3000, members: ["X"] },
      { effectiveFrom: 1000, members: ["Y"] },
    ]);
    expect(shuffled.symbolsAt(1500)).toEqual(["Y"]);
  });
});
