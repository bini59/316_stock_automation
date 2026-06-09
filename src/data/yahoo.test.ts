import { describe, it, expect } from "vitest";
import { YahooBarLoader, parseYahoo, type FetchLike } from "./yahoo";

const chart = (timestamps: number[], q: Record<string, (number | null)[]>) => ({
  ok: true,
  status: 200,
  json: async () => ({
    chart: { result: [{ timestamp: timestamps, indicators: { quote: [q] } }] },
  }),
});

describe("parseYahoo", () => {
  it("epoch초 → ms 변환, OHLCV 매핑", () => {
    const bars = parseYahoo([1577923200], {
      open: [100],
      high: [105],
      low: [99],
      close: [102],
      volume: [1000],
    });
    expect(bars[0]).toEqual({
      timestamp: 1577923200 * 1000,
      open: 100,
      high: 105,
      low: 99,
      close: 102,
      volume: 1000,
    });
  });

  it("null close 행은 제외(휴장·결측)", () => {
    const bars = parseYahoo([1, 2, 3], {
      open: [10, null, 12],
      high: [10, null, 12],
      low: [10, null, 12],
      close: [10, null, 12],
      volume: [1, null, 1],
    });
    expect(bars.length).toBe(2);
    expect(bars.map((b) => b.close)).toEqual([10, 12]);
  });

  it("open/high/low 결측 시 close로 대체", () => {
    const bars = parseYahoo([1], {
      open: [null],
      high: [null],
      low: [null],
      close: [50],
      volume: [null],
    });
    expect(bars[0]).toMatchObject({ open: 50, high: 50, low: 50, close: 50, volume: 0 });
  });
});

describe("YahooBarLoader", () => {
  it("주입 fetch로 PriceSeries 적재(정규화·시간순, 일 단위 키)", async () => {
    const D = 86_400; // 1일(초)
    const fetchFn: FetchLike = async () =>
      chart([2 * D, 1 * D], { open: [2, 1], high: [2, 1], low: [2, 1], close: [2, 1], volume: [1, 1] });
    const loader = new YahooBarLoader({ from: 0, to: 10 * D * 1000, fetchFn });
    const s = await loader.load("SPY");
    // UTC 자정 정규화 + 시간 오름차순
    expect(s.map((b) => b.timestamp)).toEqual([1 * D * 1000, 2 * D * 1000]);
  });

  it("URL에 period1/period2(초)·interval 포함", async () => {
    let captured = "";
    const fetchFn: FetchLike = async (url) => {
      captured = url;
      return chart([1], { open: [1], high: [1], low: [1], close: [1], volume: [1] });
    };
    const loader = new YahooBarLoader({ from: 1_000_000, to: 2_000_000, fetchFn, interval: "1d" });
    await loader.load("^VIX");
    expect(captured).toContain("period1=1000");
    expect(captured).toContain("period2=2000");
    expect(captured).toContain("interval=1d");
    expect(captured).toContain(encodeURIComponent("^VIX"));
  });

  it("HTTP 오류 → 예외", async () => {
    const fetchFn: FetchLike = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const loader = new YahooBarLoader({ from: 0, to: 1, fetchFn });
    await expect(loader.load("SPY")).rejects.toThrow(/429/);
  });

  it("빈 응답 → 예외", async () => {
    const fetchFn: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ chart: { result: [] } }) });
    const loader = new YahooBarLoader({ from: 0, to: 1, fetchFn });
    await expect(loader.load("SPY")).rejects.toThrow(/데이터 없음/);
  });
});
