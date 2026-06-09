export {
  mean,
  stddev,
  sma,
  ema,
  emaSeries,
  logReturns,
  realizedVol,
  rollingPercentile,
  winsorize,
  zScore,
  sigmoid,
  clamp,
  normalizedEntropy,
  pearson,
} from "./stats";
export {
  kaufmanER,
  smaSlope,
  distanceFromSma,
  momentum,
  momentum12_1,
  rsi,
  bollinger,
  currentDrawdown,
} from "./signals";
export type { BollingerBands } from "./signals";

/** closes 추출 헬퍼: PriceSeries → close 배열 */
export function closesOf(series: ReadonlyArray<{ close: number }>): number[] {
  return series.map((b) => b.close);
}
