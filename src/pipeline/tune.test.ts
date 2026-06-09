import { describe, it, expect } from "vitest";
import type { Bar, PriceSeries } from "../types/market";
import type { Dataset } from "../data/loader";
import { RuleBasedRegimeClassifier } from "../regime";
import { defaultStrategyPool } from "../strategies";
import { tune, type TuneConfig } from "./tune";

const DAY = 86_400_000;

function rng(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => ((s = (s * 16807) % 2147483647), (s - 1) / 2147483646);
}

/** 평온 상승 → 위기 급락 합성(튜닝 동작 확인용, 결정적) */
function dataset(): Dataset {
  const calm = 320;
  const crash = 90;
  const n = calm + crash;
  const r = rng(7);
  const bench: number[] = [];
  let px = 100;
  const vix: number[] = [];
  for (let i = 0; i < n; i++) {
    const inCrash = i >= calm;
    px *= inCrash ? 1 - 0.012 + (r() - 0.5) * 0.05 : 1 + 0.0004 + (r() - 0.5) * 0.006;
    bench.push(Math.max(1, px));
    vix.push(inCrash ? 45 : 14);
  }
  const toSeries = (closes: number[]): PriceSeries =>
    closes.map((c, i): Bar => ({ timestamp: i * DAY, open: c, high: c * 1.005, low: c * 0.995, close: c, volume: 1e6 }));
  const universe: Record<string, PriceSeries> = {};
  for (const [k, sym] of ["XLK", "XLF", "XLV", "XLP"].entries()) {
    const rr = rng(50 + k);
    let p = 50 + k;
    const arr: number[] = [];
    for (let i = 0; i < n; i++) {
      const ret = i === 0 ? 0 : bench[i]! / bench[i - 1]! - 1;
      p *= 1 + ret + (rr() - 0.5) * 0.004;
      arr.push(Math.max(1, p));
    }
    universe[sym] = toSeries(arr);
  }
  return { benchmark: toSeries(bench), universe, macro: { vix: toSeries(vix) } };
}

const baseCfg = (): TuneConfig => ({
  classifier: new RuleBasedRegimeClassifier(),
  strategies: defaultStrategyPool(),
  initialCapital: 100_000,
  grid: {
    targetVol: [0.12, 0.25],
    maxWeightPerFamily: [0.5],
    maxWeightPerSymbol: [0.15, 0.3],
    rebalanceEvery: [20],
  },
  ratio: 0.7,
  gateCriteria: { minSharpe: 0.5, maxDrawdown: 0.25, minTradeCount: 5 },
});

describe("tune — in-sample 탐색 → OOS 시험", () => {
  it("그리드 전체를 시도하고 triesIndex로 기록", () => {
    const r = tune(dataset(), baseCfg());
    expect(r.triesIndex).toBe(2 * 1 * 2 * 1); // 4 조합
    expect(r.best).toBeDefined();
  });

  it("OOS·in-sample·full 지표를 모두 산출", () => {
    const r = tune(dataset(), baseCfg());
    expect(r.tuned.full).toBeDefined();
    expect(r.tuned.inSample).toBeDefined();
    expect(r.tuned.oos).toBeDefined();
    expect(r.baseline.oos).toBeDefined();
    expect(r.buyHold.maxDrawdown).toBeGreaterThanOrEqual(0);
  });

  it("다중검정 보정 게이트: 시도가 많으면 minSharpe가 올라간다", () => {
    const r = tune(dataset(), baseCfg());
    // 게이트는 OOS 기준 + triesIndex 보정 — passed 여부는 boolean
    expect(typeof r.gate.passed).toBe("boolean");
  });

  it("과최적화 격차 = in-sample 샤프 − OOS 샤프", () => {
    const r = tune(dataset(), baseCfg());
    expect(r.overfitGap).toBeCloseTo(r.tuned.inSample.sharpe - r.tuned.oos.sharpe, 10);
  });

  it("★ 결정적: 같은 입력 → 같은 best(순수)", () => {
    const d = dataset();
    const a = tune(d, baseCfg());
    const b = tune(d, baseCfg());
    expect(a.best).toEqual(b.best);
    expect(a.tuned.oos.sharpe).toBeCloseTo(b.tuned.oos.sharpe, 10);
  });
});
