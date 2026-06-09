/**
 * 추세/모멘텀 패밀리 (TODO 4.2.2, docs/strategy/strategy-pool.md 5.1).
 *
 * 공통 필터: 200일선 위 종목만 후보(추세 정렬). 동일가중 또는 역변동성 가중.
 * affinity: 추세장(bull) 강, 톱질장(chop) 약.
 *
 * ★ look-ahead: 모든 지표는 trailing(closesOf → momentum/sma 등). 미래 미참조.
 * ★ 무상태·순수: 같은 (universe, regime)이면 같은 결과.
 */
import type {
  RegimeStrategy,
  UniverseHistory,
} from "../types/strategy";
import type { RegimeLabel, RegimeState } from "../types/regime";
import {
  closesOf,
  distanceFromSma,
  momentum,
  momentum12_1,
  realizedVol,
} from "../indicators";
import { equalWeight, inverseVolWeight } from "./weights";

const TREND_AFFINITY: Readonly<Partial<Record<RegimeLabel, number>>> = {
  bull: 1.0,
  chop: 0.2,
};

/** 200일선 위에 있는 종목만 통과(추세 정렬 필터). 데이터 부족·아래면 제외. */
function aboveTrend(
  universe: UniverseHistory,
  smaWindow: number,
): { symbol: string; closes: number[] }[] {
  const out: { symbol: string; closes: number[] }[] = [];
  for (const [symbol, series] of Object.entries(universe)) {
    const closes = closesOf(series);
    const dist = distanceFromSma(closes, smaWindow);
    if (dist !== undefined && dist > 0) out.push({ symbol, closes });
  }
  return out;
}

/** 후보들의 역변동성 가중 비중. vol 산출 불가 종목은 동일가중으로 폴백. */
function weightCandidates(
  candidates: { symbol: string; closes: number[] }[],
  volWindow: number,
  useInverseVol: boolean,
): Record<string, number> {
  if (candidates.length === 0) return {};
  if (!useInverseVol) return equalWeight(candidates.map((c) => c.symbol));
  const vols: Record<string, number> = {};
  for (const c of candidates) {
    const v = realizedVol(c.closes, volWindow);
    if (v !== undefined && v > 0) vols[c.symbol] = v;
  }
  const ivw = inverseVolWeight(vols);
  // 변동성 산출 불가가 많아 비어버리면 동일가중 폴백.
  if (Object.keys(ivw).length === 0) return equalWeight(candidates.map((c) => c.symbol));
  return ivw;
}

/**
 * TS 모멘텀: 종목별 12개월(252일) 절대 모멘텀 > 임계면 보유.
 * 시계열 on/off. 200일선 위 + 모멘텀>0 둘 다 충족해야 후보.
 */
export class TimeSeriesMomentum implements RegimeStrategy {
  readonly name = "trend-ts-momentum";
  readonly family = "trend" as const;
  readonly regimeAffinity = TREND_AFFINITY;
  readonly params: Readonly<Record<string, number>>;

  constructor(params: Partial<Record<string, number>> = {}) {
    this.params = {
      smaWindow: 200,
      lookback: 252,
      threshold: 0,
      volWindow: 20,
      useInverseVol: 1,
      ...params,
    };
  }

  propose(universe: UniverseHistory, _regime: RegimeState): Record<string, number> {
    const { smaWindow, lookback, threshold, volWindow, useInverseVol } = this.params;
    const candidates = aboveTrend(universe, smaWindow!).filter((c) => {
      const m = momentum(c.closes, lookback!);
      return m !== undefined && m > threshold!;
    });
    return weightCandidates(candidates, volWindow!, useInverseVol! >= 0.5);
  }
}

/**
 * XS 모멘텀: 유니버스를 12-1개월 수익률로 랭크, 상위 분위 롱.
 * 횡단면. 최근 1개월(skip) 제외로 단기 반전 회피. 200일선 위만 후보.
 */
export class CrossSectionalMomentum implements RegimeStrategy {
  readonly name = "trend-xs-momentum";
  readonly family = "trend" as const;
  readonly regimeAffinity = TREND_AFFINITY;
  readonly params: Readonly<Record<string, number>>;

  constructor(params: Partial<Record<string, number>> = {}) {
    this.params = {
      smaWindow: 200,
      lookback: 252,
      skip: 21,
      topQuantile: 0.4,
      volWindow: 20,
      useInverseVol: 1,
      ...params,
    };
  }

  propose(universe: UniverseHistory, _regime: RegimeState): Record<string, number> {
    const { smaWindow, lookback, skip, topQuantile, volWindow, useInverseVol } = this.params;
    const scored = aboveTrend(universe, smaWindow!)
      .map((c) => ({ ...c, score: momentum12_1(c.closes, lookback!, skip!) }))
      .filter((c): c is { symbol: string; closes: number[]; score: number } => c.score !== undefined)
      .sort((a, b) => b.score - a.score);
    if (scored.length === 0) return {};
    const topN = Math.max(1, Math.ceil(scored.length * clampQuantile(topQuantile!)));
    const top = scored.slice(0, topN);
    return weightCandidates(top, volWindow!, useInverseVol! >= 0.5);
  }
}

/**
 * 듀얼 모멘텀: XS 랭크 상위 + 절대 모멘텀(12-1 > 0) 동시 충족만 보유.
 * 약세 진입 자동 회피(절대 모멘텀 음수면 후보에서 빠짐).
 */
export class DualMomentum implements RegimeStrategy {
  readonly name = "trend-dual-momentum";
  readonly family = "trend" as const;
  readonly regimeAffinity = TREND_AFFINITY;
  readonly params: Readonly<Record<string, number>>;

  constructor(params: Partial<Record<string, number>> = {}) {
    this.params = {
      smaWindow: 200,
      lookback: 252,
      skip: 21,
      topQuantile: 0.4,
      absThreshold: 0,
      volWindow: 20,
      useInverseVol: 1,
      ...params,
    };
  }

  propose(universe: UniverseHistory, _regime: RegimeState): Record<string, number> {
    const { smaWindow, lookback, skip, topQuantile, absThreshold, volWindow, useInverseVol } =
      this.params;
    const scored = aboveTrend(universe, smaWindow!)
      .map((c) => ({ ...c, score: momentum12_1(c.closes, lookback!, skip!) }))
      .filter(
        (c): c is { symbol: string; closes: number[]; score: number } =>
          c.score !== undefined && c.score > absThreshold!, // 절대 모멘텀 게이트
      )
      .sort((a, b) => b.score - a.score);
    if (scored.length === 0) return {};
    const topN = Math.max(1, Math.ceil(scored.length * clampQuantile(topQuantile!)));
    const top = scored.slice(0, topN);
    return weightCandidates(top, volWindow!, useInverseVol! >= 0.5);
  }
}

function clampQuantile(q: number): number {
  if (!Number.isFinite(q)) return 0.4;
  return Math.min(1, Math.max(0.01, q));
}

/** 기본 추세 전략 묶음. */
export function trendStrategies(): RegimeStrategy[] {
  return [new TimeSeriesMomentum(), new CrossSectionalMomentum(), new DualMomentum()];
}
