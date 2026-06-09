import { describe, it, expect, vi } from "vitest";
import { MemoryCache, CachedBarLoader, cacheKey } from "./cache";
import { InMemoryBarLoader, type BarLoader } from "./loader";
import type { Bar, PriceSeries } from "../types/market";

const bar = (t: number, c: number): Bar => ({
  timestamp: t,
  open: c,
  high: c,
  low: c,
  close: c,
  volume: 1,
});

describe("MemoryCache", () => {
  it("set/get 왕복", async () => {
    const c = new MemoryCache();
    const s: PriceSeries = [bar(1, 100)];
    await c.set("k", s);
    expect(await c.get("k")).toEqual(s);
  });
  it("미존재 키 → undefined", async () => {
    expect(await new MemoryCache().get("none")).toBeUndefined();
  });
});

describe("CachedBarLoader", () => {
  it("캐시 미스 → 소스 적재 후 저장, 히트 → 소스 미접근", async () => {
    const inner: BarLoader = new InMemoryBarLoader({ SPY: [bar(1, 100), bar(2, 101)] });
    const loadSpy = vi.spyOn(inner, "load");
    const cached = new CachedBarLoader(inner, new MemoryCache());

    const first = await cached.load("SPY");
    const second = await cached.load("SPY");

    expect(first).toEqual(second);
    expect(loadSpy).toHaveBeenCalledTimes(1); // 두 번째는 캐시 히트
  });

  it("cacheKey는 심볼 기반 결정적 키", () => {
    expect(cacheKey("SPY")).toBe(cacheKey("SPY"));
    expect(cacheKey("SPY")).not.toBe(cacheKey("QQQ"));
  });
});
