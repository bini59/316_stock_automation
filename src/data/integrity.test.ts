import { describe, it, expect } from "vitest";
import { validateSeries, normalizeSeries, alignUniverse } from "./integrity";
import type { Bar, PriceSeries } from "../types/market";

const bar = (t: number, c: number, over: Partial<Bar> = {}): Bar => ({
  timestamp: t,
  open: c,
  high: c,
  low: c,
  close: c,
  volume: 100,
  ...over,
});

describe("validateSeries", () => {
  it("정상 시계열 → ok", () => {
    expect(validateSeries([bar(1, 100), bar(2, 101)]).ok).toBe(true);
  });
  it("시간 역순 탐지", () => {
    const r = validateSeries([bar(2, 100), bar(1, 101)]);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("역순"))).toBe(true);
  });
  it("중복 타임스탬프 탐지", () => {
    const r = validateSeries([bar(1, 100), bar(1, 101)]);
    expect(r.issues.some((i) => i.message.includes("중복"))).toBe(true);
  });
  it("OHLC 모순 탐지 (high<low)", () => {
    const r = validateSeries([bar(1, 100, { high: 90, low: 110 })]);
    expect(r.ok).toBe(false);
  });
  it("음수 가격 탐지", () => {
    const r = validateSeries([bar(1, -5)]);
    expect(r.ok).toBe(false);
  });
});

describe("normalizeSeries", () => {
  it("시간 오름차순 정렬 + 중복 제거(나중 값 우선)", () => {
    const s: PriceSeries = [bar(3, 103), bar(1, 100), bar(1, 999), bar(2, 102)];
    const n = normalizeSeries(s);
    expect(n.map((b) => b.timestamp)).toEqual([1, 2, 3]);
    expect(n[0]!.close).toBe(999); // 마지막 ts=1 값
  });
  it("입력을 변이하지 않는다", () => {
    const s = [bar(2, 100), bar(1, 100)];
    normalizeSeries(s);
    expect(s[0]!.timestamp).toBe(2);
  });
});

describe("alignUniverse", () => {
  it("공통 타임스탬프로 정렬 → 동일 길이·인덱스", () => {
    const u = {
      SPY: [bar(1, 100), bar(2, 101), bar(3, 102)],
      QQQ: [bar(2, 201), bar(3, 202), bar(4, 203)],
    };
    const a = alignUniverse(u);
    expect(a.SPY!.map((b) => b.timestamp)).toEqual([2, 3]);
    expect(a.QQQ!.map((b) => b.timestamp)).toEqual([2, 3]);
    expect(a.SPY!.length).toBe(a.QQQ!.length);
  });
  it("빈 유니버스 → 빈 객체", () => {
    expect(alignUniverse({})).toEqual({});
  });
});
