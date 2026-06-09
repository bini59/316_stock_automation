import { describe, it, expect } from "vitest";
import { splitInOutSample } from "./splitter";
import type { Bar, PriceSeries } from "../types/market";

const series = (n: number): PriceSeries =>
  Array.from({ length: n }, (_, i): Bar => ({
    timestamp: (i + 1) * 1000,
    open: 100,
    high: 100,
    low: 100,
    close: 100 + i,
    volume: 1,
  }));

describe("splitInOutSample", () => {
  it("7:3 분할 경계", () => {
    const s = splitInOutSample(series(100), 0.7);
    expect(s.inSample.length).toBe(70);
    expect(s.outOfSample.length).toBe(30);
    expect(s.boundaryIndex).toBe(70);
  });

  it("inSampleEnd는 in-sample 마지막 바 timestamp", () => {
    const s = splitInOutSample(series(10), 0.8);
    expect(s.inSample.length).toBe(8);
    expect(s.inSampleEnd).toBe(8 * 1000);
  });

  it("분할은 시간 연속(out은 in 바로 뒤에서 시작, 누수 없음)", () => {
    const s = splitInOutSample(series(10), 0.5);
    const lastIn = s.inSample[s.inSample.length - 1]!.timestamp;
    const firstOut = s.outOfSample[0]!.timestamp;
    expect(firstOut).toBeGreaterThan(lastIn);
  });

  it("양쪽에 최소 1개 바 보장(극단 ratio)", () => {
    const s1 = splitInOutSample(series(5), 0.99);
    expect(s1.outOfSample.length).toBeGreaterThanOrEqual(1);
    const s2 = splitInOutSample(series(5), 0.01);
    expect(s2.inSample.length).toBeGreaterThanOrEqual(1);
  });

  it("잘못된 ratio·표본 부족은 예외", () => {
    expect(() => splitInOutSample(series(10), 0)).toThrow();
    expect(() => splitInOutSample(series(10), 1)).toThrow();
    expect(() => splitInOutSample(series(1), 0.5)).toThrow();
  });
});
