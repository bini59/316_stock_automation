/**
 * 추세·모멘텀·오실레이터 지표 — 전부 trailing(look-ahead 차단).
 * 마지막 원소를 "현재"로 보고 그 시점 기준 값을 반환. 부족하면 undefined.
 */
import { sma, stddev, mean } from "./stats";

/**
 * Kaufman Efficiency Ratio(window n). 0(톱질)..1(깨끗한 추세).
 * ER = |close_t − close_{t−n}| / Σ|close_i − close_{i−1}|
 */
export function kaufmanER(closes: readonly number[], n: number): number | undefined {
  if (n < 1 || closes.length < n + 1) return undefined;
  const end = closes.length - 1;
  const start = end - n;
  const direction = Math.abs(closes[end]! - closes[start]!);
  let volatility = 0;
  for (let i = start + 1; i <= end; i++) {
    volatility += Math.abs(closes[i]! - closes[i - 1]!);
  }
  if (volatility === 0) return 0;
  return direction / volatility;
}

/**
 * SMA 기울기: (SMA_t − SMA_{t−lookback}) / SMA_{t−lookback}.
 * 200일선 기울기 등. 부족하면 undefined.
 */
export function smaSlope(
  closes: readonly number[],
  window: number,
  lookback: number,
): number | undefined {
  if (closes.length < window + lookback) return undefined;
  const now = sma(closes, window);
  const past = sma(closes.slice(0, closes.length - lookback), window);
  if (now === undefined || past === undefined || past === 0) return undefined;
  return (now - past) / past;
}

/** 200일선 대비 위치: (close − SMA) / SMA. */
export function distanceFromSma(closes: readonly number[], window: number): number | undefined {
  const m = sma(closes, window);
  const last = closes[closes.length - 1];
  if (m === undefined || last === undefined || m === 0) return undefined;
  return (last - m) / m;
}

/** 단순 모멘텀: close_t / close_{t−lookback} − 1. */
export function momentum(closes: readonly number[], lookback: number): number | undefined {
  if (lookback < 1 || closes.length < lookback + 1) return undefined;
  const end = closes[closes.length - 1]!;
  const past = closes[closes.length - 1 - lookback]!;
  if (past <= 0) return undefined;
  return end / past - 1;
}

/**
 * 12-1 모멘텀: lookback개월 수익률에서 최근 skip개월을 제외(단기 반전 회피).
 * 일봉 기준 기본 lookback=252, skip=21.
 */
export function momentum12_1(
  closes: readonly number[],
  lookback = 252,
  skip = 21,
): number | undefined {
  if (lookback <= skip || closes.length < lookback + 1) return undefined;
  const recent = closes[closes.length - 1 - skip]!; // skip개월 전 가격(최근 제외)
  const past = closes[closes.length - 1 - lookback]!;
  if (past <= 0) return undefined;
  return recent / past - 1;
}

/**
 * RSI(period). Wilder 평활 없이 단순평균 버전(Connors RSI(2)에 적합).
 * 0..100. 부족하면 undefined.
 */
export function rsi(closes: readonly number[], period: number): number | undefined {
  if (period < 1 || closes.length < period + 1) return undefined;
  const slice = closes.slice(closes.length - (period + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i]! - slice[i - 1]!;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface BollingerBands {
  mid: number;
  upper: number;
  lower: number;
  /** 밴드 내 위치 0(하단)..1(상단) */
  pctB: number;
}

/** 볼린저 밴드(window, k표준편차). */
export function bollinger(
  closes: readonly number[],
  window: number,
  k = 2,
): BollingerBands | undefined {
  if (window < 2 || closes.length < window) return undefined;
  const slice = closes.slice(closes.length - window);
  const mid = mean(slice);
  const sd = stddev(slice);
  const upper = mid + k * sd;
  const lower = mid - k * sd;
  const last = slice[slice.length - 1]!;
  const pctB = upper === lower ? 0.5 : (last - lower) / (upper - lower);
  return { mid, upper, lower, pctB };
}

/**
 * 현재 낙폭(0..1): 시계열 러닝 피크 대비 현재값의 하락폭.
 * 적극도 낙폭 브레이크(sentiment) 입력용.
 */
export function currentDrawdown(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let peak = -Infinity;
  for (const v of values) if (v > peak) peak = v;
  const last = values[values.length - 1]!;
  if (peak <= 0) return last < peak ? 1 : 0;
  return Math.min(1, Math.max(0, (peak - last) / peak));
}
