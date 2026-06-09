import { describe, it, expect } from "vitest";
import {
  InMemoryBarLoader,
  parseCsv,
  parseTimestamp,
  loadDataset,
} from "./loader";
import type { Bar, PriceSeries } from "../types/market";

const bar = (t: number, c: number): Bar => ({
  timestamp: t,
  open: c,
  high: c + 1,
  low: c - 1,
  close: c,
  volume: 100,
});

describe("parseTimestamp", () => {
  it("ISO 날짜", () => {
    expect(parseTimestamp("2020-01-02")).toBe(Date.parse("2020-01-02"));
  });
  it("epoch 초(10자리) → ms", () => {
    expect(parseTimestamp("1577923200")).toBe(1577923200 * 1000);
  });
  it("epoch ms(13자리)", () => {
    expect(parseTimestamp("1577923200000")).toBe(1577923200000);
  });
  it("빈/비정상 → null", () => {
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("not-a-date")).toBeNull();
  });
});

describe("parseCsv", () => {
  it("헤더+행 파싱", () => {
    const csv = "date,open,high,low,close,volume\n2020-01-02,100,105,99,102,1000\n2020-01-03,102,106,101,104,1200";
    const bars = parseCsv(csv);
    expect(bars.length).toBe(2);
    expect(bars[0]!.close).toBe(102);
    expect(bars[1]!.volume).toBe(1200);
  });
  it("필수 헤더 누락 → 예외", () => {
    expect(() => parseCsv("foo,bar\n1,2")).toThrow();
  });
  it("빈 텍스트 → 빈 배열", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("InMemoryBarLoader", () => {
  it("정규화된 PriceSeries 반환(시간순)", async () => {
    const loader = new InMemoryBarLoader({ SPY: [bar(2, 101), bar(1, 100)] });
    const s = await loader.load("SPY");
    expect(s.map((b) => b.timestamp)).toEqual([1, 2]);
  });
  it("없는 심볼 → 예외", async () => {
    const loader = new InMemoryBarLoader({});
    await expect(loader.load("X")).rejects.toThrow();
  });
});

describe("loadDataset", () => {
  const mk = (closes: number[]): PriceSeries => closes.map((c, i) => bar(i + 1, c));

  it("벤치마크+유니버스+매크로 적재, 유니버스 정렬", async () => {
    const loader = new InMemoryBarLoader({
      SPY: mk([100, 101, 102]),
      XLK: [bar(1, 50), bar(2, 51), bar(3, 52)],
      XLF: [bar(2, 30), bar(3, 31), bar(4, 32)],
      "^VIX": mk([20, 21, 22]),
    });
    const ds = await loadDataset(loader, {
      benchmark: "SPY",
      universe: ["XLK", "XLF"],
      vix: "^VIX",
    });
    expect(ds.benchmark.length).toBe(3);
    // 공통 타임스탬프 2,3만
    expect(ds.universe.XLK!.map((b) => b.timestamp)).toEqual([2, 3]);
    expect(ds.universe.XLF!.map((b) => b.timestamp)).toEqual([2, 3]);
    expect(ds.macro.vix?.length).toBe(3);
  });

  it("정합 깨진 데이터(시간 역순) → 예외", async () => {
    const loader = new InMemoryBarLoader({
      SPY: [bar(1, 100)],
      BAD: [{ ...bar(1, 100), high: 1, low: 999 }],
    });
    await expect(
      loadDataset(loader, { benchmark: "SPY", universe: ["BAD"] }),
    ).rejects.toThrow(/정합/);
  });
});
