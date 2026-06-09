/**
 * 통계 지표 — 전부 trailing window 기반(look-ahead 차단).
 *
 * 절대 규약: 모든 함수는 "현재 시점까지" 배열을 받아 마지막 원소(=현재)를
 * 기준으로 한 통계를 반환한다. 배열 끝 이후를 절대 인덱싱하지 않는다.
 * 데이터가 부족하면 undefined를 반환한다(조용한 0 대신 명시적 부족 신호).
 *
 * regime/strategies/sentiment/meta 레이어가 공유하는 look-ahead-safe 코어.
 */

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** 표본 표준편차(n-1, sample=true) 또는 모표준편차(n). n<2면 0. */
export function stddev(xs: readonly number[], sample = true): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  const denom = sample ? n - 1 : n;
  const variance = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / denom;
  return Math.sqrt(variance);
}

/** 마지막 window개의 단순이동평균(trailing). 부족하면 undefined. */
export function sma(values: readonly number[], window: number): number | undefined {
  if (window < 1 || values.length < window) return undefined;
  const slice = values.slice(values.length - window);
  return mean(slice);
}

/**
 * 지수이동평균(EMA)의 현재값. span으로 α=2/(span+1).
 * 시계열 처음부터 현재까지 순방향 재귀 → 마지막 값이 "현재" EMA.
 */
export function ema(values: readonly number[], span: number): number | undefined {
  if (span < 1 || values.length === 0) return undefined;
  const alpha = 2 / (span + 1);
  let e = values[0]!;
  for (let i = 1; i < values.length; i++) {
    e = alpha * values[i]! + (1 - alpha) * e;
  }
  return e;
}

/** 전체 시계열의 EMA 경로(각 시점의 EMA). 마지막이 현재값과 동일. */
export function emaSeries(values: readonly number[], span: number): number[] {
  if (span < 1 || values.length === 0) return [];
  const alpha = 2 / (span + 1);
  const out: number[] = [values[0]!];
  for (let i = 1; i < values.length; i++) {
    out.push(alpha * values[i]! + (1 - alpha) * out[i - 1]!);
  }
  return out;
}

/** 로그수익률 배열. 길이 = values.length - 1. */
export function logReturns(values: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!;
    const cur = values[i]!;
    if (prev <= 0 || cur <= 0) {
      out.push(0);
      continue;
    }
    out.push(Math.log(cur / prev));
  }
  return out;
}

/**
 * 연율화 실현변동성: 마지막 window개 로그수익률의 표준편차 × √periodsPerYear.
 * 부족하면 undefined.
 */
export function realizedVol(
  closes: readonly number[],
  window: number,
  periodsPerYear = 252,
): number | undefined {
  const rets = logReturns(closes);
  if (rets.length < window) return undefined;
  const slice = rets.slice(rets.length - window);
  return stddev(slice) * Math.sqrt(periodsPerYear);
}

/**
 * 후행 백분위(0..1): 마지막 window개 중 현재값(마지막)의 순위 분위.
 * "현재 값이 최근 분포에서 어디쯤인가"를 미래 참조 없이 계산.
 */
export function rollingPercentile(values: readonly number[], window: number): number | undefined {
  if (window < 2 || values.length < window) return undefined;
  const slice = values.slice(values.length - window);
  const current = slice[slice.length - 1]!;
  let countBelowOrEqual = 0;
  for (const v of slice) if (v <= current) countBelowOrEqual++;
  return countBelowOrEqual / slice.length;
}

/** ±limitσ로 윈저라이즈(클립). */
export function winsorize(value: number, m: number, sd: number, limit = 3): number {
  if (sd === 0) return value;
  const lo = m - limit * sd;
  const hi = m + limit * sd;
  return Math.min(hi, Math.max(lo, value));
}

/**
 * 후행 z-스코어: (현재값 − trailing 평균) / trailing 표준편차.
 * 이상치는 ±3σ로 윈저라이즈한 뒤 z를 계산(극단값 지배 방지).
 */
export function zScore(values: readonly number[], window: number): number | undefined {
  if (window < 2 || values.length < window) return undefined;
  const slice = values.slice(values.length - window);
  const m = mean(slice);
  const sd = stddev(slice);
  if (sd === 0) return 0;
  const current = winsorize(slice[slice.length - 1]!, m, sd);
  return (current - m) / sd;
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * 정규화 엔트로피(0..1). probs는 합 1 가정. 균등분포면 1, 한 곳 집중이면 0.
 * confidence = 1 − normalizedEntropy.
 */
export function normalizedEntropy(probs: readonly number[]): number {
  const k = probs.length;
  if (k <= 1) return 0;
  let h = 0;
  for (const p of probs) {
    if (p > 0) h -= p * Math.log(p);
  }
  return h / Math.log(k);
}

/** 피어슨 상관계수. 길이 다르면 짧은 쪽 끝에 맞춰 정렬(최근값 정렬). */
export function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const aa = a.slice(a.length - n);
  const bb = b.slice(b.length - n);
  const ma = mean(aa);
  const mb = mean(bb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = aa[i]! - ma;
    const y = bb[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}
