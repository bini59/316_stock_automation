/**
 * 성과 지표 계산 (docs/strategy/validation.md).
 *
 * 단순 수익률만 보지 않는다: 샤프(위험 대비 수익), MDD(고점 대비 낙폭),
 * 승률을 함께 본다. 모든 입력 equityCurve는 거래비용 차감 후 값이어야 한다.
 */
import type { Metrics, Trade } from "../types/result";

/** 거래일 기준 연율화 계수 (일봉 기본) */
export const TRADING_DAYS_PER_YEAR = 252;

/** equityCurve → 기간별 단순 수익률 배열 */
export function periodReturns(equityCurve: readonly number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1];
    const cur = equityCurve[i];
    if (prev === undefined || cur === undefined || prev === 0) {
      returns.push(0);
      continue;
    }
    returns.push(cur / prev - 1);
  }
  return returns;
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** 표본 표준편차 (n-1). n<2면 0 */
function sampleStd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/**
 * 연율화 샤프 비율 (무위험 수익률 0 가정).
 * sharpe = mean(r)/std(r) × √(periodsPerYear). 변동성 0이면 0 반환.
 */
export function annualizedSharpe(
  returns: readonly number[],
  periodsPerYear: number = TRADING_DAYS_PER_YEAR,
): number {
  const sd = sampleStd(returns);
  if (sd === 0) return 0;
  return (mean(returns) / sd) * Math.sqrt(periodsPerYear);
}

/** 최대 낙폭 0..1 (고점 대비 최대 하락폭). 단조 상승이면 0. */
export function maxDrawdown(equityCurve: readonly number[]): number {
  let peak = -Infinity;
  let mdd = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > mdd) mdd = dd;
    }
  }
  return mdd;
}

export function computeMetrics(
  equityCurve: readonly number[],
  trades: readonly Trade[],
  periodsPerYear: number = TRADING_DAYS_PER_YEAR,
): Metrics {
  const first = equityCurve[0];
  const last = equityCurve[equityCurve.length - 1];
  const totalReturn =
    first !== undefined && last !== undefined && first !== 0 ? last / first - 1 : 0;

  const returns = periodReturns(equityCurve);
  const sharpe = annualizedSharpe(returns, periodsPerYear);
  const mdd = maxDrawdown(equityCurve);

  const wins = trades.filter((t) => t.pnl > 0).length;
  const winRate = trades.length > 0 ? wins / trades.length : 0;

  return {
    totalReturn,
    sharpe,
    maxDrawdown: mdd,
    winRate,
    tradeCount: trades.length,
  };
}
