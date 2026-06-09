/**
 * 국면 분류 입력 신호 계산기 (docs/strategy/regime.md 4절).
 *
 * 절대 규약: 모든 통계는 trailing window·후행 백분위로만 계산한다.
 * 각 함수는 "현재 시점까지" 배열을 받아 마지막 원소(=현재)를 기준으로 한
 * 신호값을 반환한다. 배열 끝 이후를 절대 참조하지 않는다(look-ahead 차단).
 */
import type { PriceSeries } from "../types/market";
import {
  closesOf,
  realizedVol,
  rollingPercentile,
  kaufmanER,
  smaSlope,
  distanceFromSma,
  clamp,
} from "../indicators";

/** signals 계산에 쓰는 파라미터(분류기 params에서 주입). */
export interface SignalParams {
  /** 장기 MA 기간 (기본 200) */
  smaWindow: number;
  /** 기울기 룩백 (기본 20) */
  slopeLookback: number;
  /** Kaufman ER 윈도우 (기본 30) */
  erWindow: number;
  /** 실현변동성 윈도우 (기본 20) */
  rvWindow: number;
  /** 백분위 룩백 (기본 378 ≈ 1.5년) */
  pctLookback: number;
}

/** 한 시점(history 마지막 바)의 원시 입력 신호. 부족하면 undefined. */
export interface RawSignals {
  /** (close − SMA200) / SMA200 */
  d200?: number;
  /** 200일선 기울기(20일) */
  slope200?: number;
  /** Kaufman ER (0..1) */
  er?: number;
  /** 연율화 실현변동성 */
  rv20?: number;
  /** rv20의 후행 백분위 (0..1) */
  rvPct?: number;
  /** VIX의 후행 백분위 (0..1) */
  vixPct?: number;
  /** clamp(VIX/VIX3M − 1, 0, 0.3) / 0.3 (0..1) */
  termStress?: number;
}

/**
 * 텀 구조 스트레스: VIX 텀 구조가 역전(백워데이션)되면 단기 패닉 신호.
 * clamp(VIX/VIX3M − 1, 0, 0.3) / 0.3 → 0(평시 콘탱고)..1(강한 역전).
 * 두 시계열은 history와 동일하게 "현재 시점까지"로 정렬되어 들어온다(마지막=현재).
 */
export function termStress(
  vix: PriceSeries | undefined,
  vix3m: PriceSeries | undefined,
): number | undefined {
  if (!vix || !vix3m || vix.length === 0 || vix3m.length === 0) return undefined;
  const v = vix[vix.length - 1]!.close;
  const v3 = vix3m[vix3m.length - 1]!.close;
  if (v3 <= 0) return undefined;
  return clamp(v / v3 - 1, 0, 0.3) / 0.3;
}

/**
 * VIX 백분위: VIX close의 후행 pctLookback 백분위(0..1).
 * 데이터가 룩백보다 짧으면 가용 길이로 백분위를 계산(graceful).
 */
export function vixPercentile(
  vix: PriceSeries | undefined,
  pctLookback: number,
): number | undefined {
  if (!vix || vix.length === 0) return undefined;
  const closes = closesOf(vix);
  const window = Math.min(pctLookback, closes.length);
  if (window < 2) return undefined;
  return rollingPercentile(closes, window);
}

/**
 * 기준 지수 history 마지막 바 기준 원시 신호를 계산한다.
 * 전부 trailing — history 밖(미래)을 보지 않는다.
 */
export function computeRawSignals(
  history: PriceSeries,
  ctx: { vix?: PriceSeries; vix3m?: PriceSeries } | undefined,
  params: SignalParams,
): RawSignals {
  const closes = closesOf(history);

  const d200 = distanceFromSma(closes, params.smaWindow);
  const slope200 = smaSlope(closes, params.smaWindow, params.slopeLookback);
  const er = kaufmanER(closes, params.erWindow);
  const rv20 = realizedVol(closes, params.rvWindow);

  // rvPct: rv20 시계열을 만들어 후행 백분위. 현재 시점까지의 rv 분포만 사용.
  const rvPct = rollingRvPercentile(closes, params.rvWindow, params.pctLookback);

  const vixPct = vixPercentile(ctx?.vix, params.pctLookback);
  const ts = termStress(ctx?.vix, ctx?.vix3m);

  return {
    ...(d200 !== undefined ? { d200 } : {}),
    ...(slope200 !== undefined ? { slope200 } : {}),
    ...(er !== undefined ? { er } : {}),
    ...(rv20 !== undefined ? { rv20 } : {}),
    ...(rvPct !== undefined ? { rvPct } : {}),
    ...(vixPct !== undefined ? { vixPct } : {}),
    ...(ts !== undefined ? { termStress: ts } : {}),
  };
}

/**
 * 실현변동성의 후행 백분위: 각 시점의 rv20 시계열을 구성한 뒤,
 * 마지막 pctLookback개 분포에서 현재 rv의 분위를 반환(0..1).
 * rv 시계열도 전부 trailing(각 시점은 그 시점까지의 수익률만 사용).
 */
export function rollingRvPercentile(
  closes: readonly number[],
  rvWindow: number,
  pctLookback: number,
): number | undefined {
  // rv 시계열: 인덱스 j에서 closes[0..j]의 rv20.
  const rvSeries: number[] = [];
  for (let j = rvWindow; j < closes.length; j++) {
    const rv = realizedVol(closes.slice(0, j + 1), rvWindow);
    if (rv !== undefined) rvSeries.push(rv);
  }
  if (rvSeries.length < 2) return undefined;
  const window = Math.min(pctLookback, rvSeries.length);
  return rollingPercentile(rvSeries, window);
}
