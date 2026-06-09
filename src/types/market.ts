/**
 * 시장 데이터 타입. 모든 시계열의 원자 단위.
 *
 * look-ahead 차단의 출발점: 전략·분류기에는 항상 PriceSeries의
 * "현재 시점까지" 슬라이스만 넘긴다(백테스터가 강제).
 */

export interface Bar {
  /** Unix epoch (ms) */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 시간 오름차순으로 정렬된 불변 바 배열 */
export type PriceSeries = readonly Bar[];
