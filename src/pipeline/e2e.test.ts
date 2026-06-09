/**
 * E2E (TODO 5.6) + 핵심 가설 측정(5.7).
 *
 * 합성 데이터(평온한 상승 → 위기 급락)로 전체 체인이:
 *  - 비용 반영된 BacktestRun을 떨구는지
 *  - 위기에서 crisis 국면이 점화되고 시스템이 노출을 줄여 buy&hold 대비 MDD↓
 *  - look-ahead 없이 결정적(prefix 불변)인지
 * 를 검증한다.
 */
import { describe, it, expect } from "vitest";
import type { Bar, PriceSeries } from "../types/market";
import { Broker, usBrokerConfig } from "../engine/broker";
import { backtestPortfolio } from "../engine/backtester";
import { maxDrawdown } from "../validation/metrics";
import type { Dataset } from "../data/loader";
import { runBacktest } from "./runBacktest";
import { buildBacktestRun } from "./writeArtifact";
import { defaultBacktestConfig } from "./defaults";

const DAY = 86_400_000;
const SECTORS = ["XLK", "XLF", "XLV", "XLE", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC"];
const DEFENSIVE = new Set(["XLP", "XLU", "XLV"]);

/** 결정적 의사난수(시드 기반) — RNG 비결정성 회피 */
function rng(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

interface Phase {
  calmDays: number;
  crashDays: number;
}

/** 평온 상승(낮은 변동성) → 위기 급락(높은 변동성, VIX 급등) 합성 데이터 */
function makeSyntheticDataset(p: Phase = { calmDays: 420, crashDays: 110 }): Dataset {
  const n = p.calmDays + p.crashDays;
  const r = rng(42);
  const bench: number[] = [];
  const vixArr: number[] = [];
  const vix3mArr: number[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const inCrash = i >= p.calmDays;
    if (!inCrash) {
      price *= 1 + 0.0004 + (r() - 0.5) * 0.006; // 완만 상승, 저변동
      vixArr.push(13 + (r() - 0.5) * 2);
      vix3mArr.push(16 + (r() - 0.5) * 2); // 콘탱고(VIX<VIX3M)
    } else {
      price *= 1 - 0.012 + (r() - 0.5) * 0.05; // 급락 + 고변동
      vixArr.push(45 + r() * 20);
      vix3mArr.push(38 + r() * 10); // 백워데이션(VIX>VIX3M)
    }
    bench.push(Math.max(1, price));
  }

  const toSeries = (closes: number[]): PriceSeries =>
    closes.map((c, i): Bar => ({
      timestamp: i * DAY,
      open: c,
      high: c * 1.005,
      low: c * 0.995,
      close: c,
      volume: 1_000_000,
    }));

  const universe: Record<string, PriceSeries> = {};
  for (let k = 0; k < SECTORS.length; k++) {
    const sym = SECTORS[k]!;
    const rr = rng(100 + k);
    const isDef = DEFENSIVE.has(sym);
    const closes: number[] = [];
    let px = 50 + k;
    for (let i = 0; i < n; i++) {
      const inCrash = i >= p.calmDays;
      const benchRet = i === 0 ? 0 : bench[i]! / bench[i - 1]! - 1;
      // 방어섹터는 위기에 덜 빠진다(베타<1)
      const beta = inCrash && isDef ? 0.45 : 1.0;
      px *= 1 + benchRet * beta + (rr() - 0.5) * 0.004;
      closes.push(Math.max(1, px));
    }
    universe[sym] = toSeries(closes);
  }

  return {
    benchmark: toSeries(bench),
    universe,
    macro: { vix: toSeries(vixArr), vix3m: toSeries(vix3mArr) },
  };
}

describe("E2E — 전체 파이프라인", () => {
  const dataset = makeSyntheticDataset();

  it("BacktestRun artifact를 비용 반영해 산출(shape·게이트·OOS)", () => {
    const cfg = defaultBacktestConfig();
    const run = buildBacktestRun(dataset, cfg, {
      id: "e2e-test",
      createdAt: 0,
      params: { rebalanceEvery: 5 },
      gateCriteria: { minSharpe: 0.5, maxDrawdown: 0.25, minTradeCount: 5 },
      triesIndex: 1,
    });
    expect(run.id).toBe("e2e-test");
    expect(run.result.equityCurve.length).toBeGreaterThan(100);
    expect(run.universe.length).toBe(SECTORS.length);
    expect(run.oosResult).toBeDefined();
    expect(run.split.inSampleEnd).toBeGreaterThan(0);
    expect(typeof run.gate.passed).toBe("boolean");
    // 비용 반영: equity가 유한하고 0 이상
    expect(run.result.equityCurve.every((e) => Number.isFinite(e) && e >= 0)).toBe(true);
  });

  it("거래비용 on이 off보다 최종 자본을 낮춘다(비용 반영 확인)", () => {
    const off = runBacktest(
      dataset,
      defaultBacktestConfig({
        broker: new Broker(usBrokerConfig({ commissionRate: 0, feeRate: 0, fxSpread: 0, slippageRate: 0 })),
      }),
    );
    const on = runBacktest(
      dataset,
      defaultBacktestConfig({
        broker: new Broker(usBrokerConfig({ commissionRate: 0.01, slippageRate: 0.005 })),
      }),
    );
    const lastOff = off.result.equityCurve[off.result.equityCurve.length - 1]!;
    const lastOn = on.result.equityCurve[on.result.equityCurve.length - 1]!;
    expect(lastOn).toBeLessThanOrEqual(lastOff);
  });

  it("★ 위기 점화: 급락 구간에서 crisis 멤버십이 충분히 오른다", () => {
    const out = runBacktest(dataset, defaultBacktestConfig());
    const crashStartTs = 420 * DAY;
    const crashPoints = out.regimePath.filter((p) => p.timestamp >= crashStartTs);
    const maxCrisis = Math.max(...crashPoints.map((p) => p.membership.crisis));
    expect(maxCrisis).toBeGreaterThan(0.3);
    // 위기에 적극도(노출)가 줄어든다
    const minAgg = Math.min(...crashPoints.map((p) => p.aggressiveness));
    expect(minAgg).toBeLessThan(0.6);
  });

  it("★ 핵심 가설(5.7): 국면 조건부 시스템이 buy&hold 대비 MDD를 줄인다", () => {
    const out = runBacktest(dataset, defaultBacktestConfig());
    const stratMdd = maxDrawdown(out.result.equityCurve);

    // buy&hold: 벤치마크 단일종목 100% 보유
    const bh = backtestPortfolio({
      universe: { SPY: dataset.benchmark },
      broker: new Broker(usBrokerConfig()),
      initialCapital: 100_000,
      rebalanceEvery: 5,
      targetWeights: () => ({ SPY: 1 }),
    });
    const bhMdd = maxDrawdown(bh.equityCurve);

    // 시스템이 위기에 디리스크 → buy&hold보다 덜 빠진다
    expect(stratMdd).toBeLessThan(bhMdd);
  });

  it("★ look-ahead: prefix로 돌린 결과가 full의 앞부분과 동일(미래 무참조)", () => {
    const full = runBacktest(dataset, defaultBacktestConfig());
    const prefixMacro: Dataset["macro"] = {};
    if (dataset.macro.vix) prefixMacro.vix = dataset.macro.vix.slice(0, 300);
    if (dataset.macro.vix3m) prefixMacro.vix3m = dataset.macro.vix3m.slice(0, 300);
    const prefixDataset: Dataset = {
      benchmark: dataset.benchmark.slice(0, 300),
      universe: Object.fromEntries(
        Object.entries(dataset.universe).map(([s, v]) => [s, v.slice(0, 300)]),
      ),
      macro: prefixMacro,
    };
    const prefix = runBacktest(prefixDataset, defaultBacktestConfig());
    // 앞 구간 equity가 미래 데이터 유무와 무관하게 동일
    for (let i = 0; i < prefix.result.equityCurve.length; i++) {
      expect(prefix.result.equityCurve[i]).toBeCloseTo(full.result.equityCurve[i]!, 6);
    }
  });
});
