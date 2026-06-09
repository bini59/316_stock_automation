/**
 * 전략 테스트용 시계열 빌더(테스트 전용, 프로덕션 비포함).
 */
import type { Bar, PriceSeries } from "../types/market";
import type { RegimeLabel, RegimeState } from "../types/regime";

const DAY = 86_400_000;

/** close 배열 → PriceSeries(OHLCV 채움, 오름차순 timestamp). */
export function seriesFromCloses(closes: readonly number[], start = 0): PriceSeries {
  return closes.map<Bar>((c, i) => ({
    timestamp: start + i * DAY,
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 1000,
  }));
}

/** 선형 상승 시계열: start에서 step씩 n개. */
export function rising(n: number, startPrice = 100, step = 1): number[] {
  return Array.from({ length: n }, (_, i) => startPrice + i * step);
}

/** 선형 하락 시계열. */
export function falling(n: number, startPrice = 300, step = 1): number[] {
  return Array.from({ length: n }, (_, i) => startPrice - i * step);
}

/** 톱질(레인지) 시계열: 평균 mid 주변 amp 진폭으로 진동. */
export function choppy(n: number, mid = 100, amp = 5): number[] {
  return Array.from({ length: n }, (_, i) => mid + amp * Math.sin(i / 2));
}

/** membership만 지정하면 나머지 필드는 합리적 기본값으로 채운 RegimeState. */
export function regimeState(
  membership: Partial<Record<RegimeLabel, number>>,
  label: RegimeLabel = "bull",
): RegimeState {
  const full: Record<RegimeLabel, number> = {
    bull: membership.bull ?? 0,
    bear: membership.bear ?? 0,
    chop: membership.chop ?? 0,
    crisis: membership.crisis ?? 0,
  };
  return {
    asOf: 0,
    trend: 0,
    volatility: 0,
    trendQuality: 0,
    membership: full,
    label,
    confidence: 0.5,
  };
}
