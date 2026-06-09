/**
 * 워크포워드 분석 (TODO 2.7, docs/strategy/validation.md 3번).
 *
 * "N년 학습 → M개월 검증 → 창을 앞으로 굴려 반복". 실제 운영에서 주기적으로
 * 재학습하는 환경을 가장 비슷하게 흉내 낸다. 여러 구간에서 일관된 성과가
 * 나오는지 본다.
 *
 * ★ look-ahead 차단: 각 창의 train은 항상 test보다 시간상 앞이다. test 구간이
 * 미래를 넘지 않도록 경계를 만든다(인덱스 end는 exclusive).
 */
import type { PriceSeries } from "../types/market";
import type { Metrics } from "../types/result";

export interface WalkForwardWindow {
  /** 학습 구간 [trainStart, trainEnd) */
  trainStart: number;
  trainEnd: number;
  /** 검증 구간 [testStart, testEnd) — 항상 trainEnd 이후 */
  testStart: number;
  testEnd: number;
}

/**
 * rolling window 경계 생성.
 * @param length 전체 바 개수
 * @param trainSize 학습 창 크기(바)
 * @param testSize 검증 창 크기(바)
 * @param step 창을 앞으로 굴리는 간격(바). 기본 testSize(비중복)
 */
export function generateWindows(
  length: number,
  trainSize: number,
  testSize: number,
  step: number = testSize,
): WalkForwardWindow[] {
  if (trainSize < 1 || testSize < 1 || step < 1) {
    throw new Error("generateWindows: trainSize/testSize/step must be >= 1");
  }
  const windows: WalkForwardWindow[] = [];
  let trainStart = 0;
  while (trainStart + trainSize + testSize <= length) {
    const trainEnd = trainStart + trainSize;
    const testStart = trainEnd; // test는 train 바로 뒤 — 미래만 검증
    const testEnd = testStart + testSize;
    windows.push({ trainStart, trainEnd, testStart, testEnd });
    trainStart += step;
  }
  return windows;
}

export interface WalkForwardResult {
  windows: WalkForwardWindow[];
  /** 각 창의 검증(test) 구간 지표 */
  testMetrics: Metrics[];
  consistency: {
    windowCount: number;
    /** test totalReturn>0 인 창 비율 0..1 */
    positiveRate: number;
    meanSharpe: number;
    /** 창 간 샤프 표준편차(낮을수록 일관) */
    sharpeStd: number;
    meanTestReturn: number;
  };
}

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function std(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
}

/**
 * 워크포워드 실행. evaluate는 (train, test) 슬라이스를 받아 test 구간 지표를 반환.
 * train으로 파라미터를 정하고 test로 시험하는 책임은 evaluate 안에 있다.
 */
export function walkForwardAnalyze(
  series: PriceSeries,
  opts: { trainSize: number; testSize: number; step?: number },
  evaluate: (train: PriceSeries, test: PriceSeries, window: WalkForwardWindow) => Metrics,
): WalkForwardResult {
  const windows = generateWindows(
    series.length,
    opts.trainSize,
    opts.testSize,
    opts.step ?? opts.testSize,
  );
  const testMetrics = windows.map((w) => {
    const train = series.slice(w.trainStart, w.trainEnd);
    const test = series.slice(w.testStart, w.testEnd);
    return evaluate(train, test, w);
  });

  const sharpes = testMetrics.map((m) => m.sharpe);
  const returns = testMetrics.map((m) => m.totalReturn);
  const positive = returns.filter((r) => r > 0).length;

  return {
    windows,
    testMetrics,
    consistency: {
      windowCount: windows.length,
      positiveRate: windows.length > 0 ? positive / windows.length : 0,
      meanSharpe: mean(sharpes),
      sharpeStd: std(sharpes),
      meanTestReturn: mean(returns),
    },
  };
}
