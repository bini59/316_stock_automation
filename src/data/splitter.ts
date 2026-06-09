/**
 * in-sample / out-of-sample 분할 (TODO 2.6, docs/strategy/validation.md 1·2번).
 *
 * ★ OOS 데이터는 튜닝에 절대 노출 금지. 파라미터 탐색은 inSample로만 하고,
 * outOfSample은 "한 번도 안 본" 데이터로 시험만 한다(보는 순간 in-sample이 됨).
 * 시간 순서 분할만 한다(랜덤 셔플 금지 — 시계열 누수 방지).
 */
import type { PriceSeries } from "../types/market";

export interface InOutSplit {
  inSample: PriceSeries;
  outOfSample: PriceSeries;
  /** in-sample 마지막 바의 timestamp (artifact.split.inSampleEnd 와 일치) */
  inSampleEnd: number;
  /** in-sample 바 개수(경계 인덱스) */
  boundaryIndex: number;
}

/**
 * 시간 순서대로 앞 ratio를 in-sample, 뒤를 out-of-sample로 분할.
 * @param ratio 0<ratio<1, 기본 0.75 (7:3~8:2 권장)
 */
export function splitInOutSample(series: PriceSeries, ratio = 0.75): InOutSplit {
  if (ratio <= 0 || ratio >= 1) {
    throw new Error(`splitInOutSample: ratio must be in (0,1), got ${ratio}`);
  }
  if (series.length < 2) {
    throw new Error(`splitInOutSample: need >=2 bars, got ${series.length}`);
  }
  // 양쪽에 최소 1개 바를 보장
  const boundaryIndex = Math.min(
    series.length - 1,
    Math.max(1, Math.floor(series.length * ratio)),
  );
  const inSample = series.slice(0, boundaryIndex);
  const outOfSample = series.slice(boundaryIndex);
  const inSampleEnd = inSample[inSample.length - 1]!.timestamp;
  return { inSample, outOfSample, inSampleEnd, boundaryIndex };
}
