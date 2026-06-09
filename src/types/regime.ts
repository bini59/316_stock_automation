/**
 * 국면 분류 레이어의 타입 계약 (docs/strategy/regime.md).
 *
 * 핵심 계약은 단일 라벨이 아니라 `membership`(소프트 소속도, 합=1).
 * 상위 레이어(전략 풀)는 `membership`만 소비한다 — 분류기를 갈아끼워도
 * 위층이 안 깨지게.
 */
import type { PriceSeries } from "./market";

export type RegimeLabel = "bull" | "bear" | "chop" | "crisis";

export interface RegimeState {
  /** Unix epoch (ms), 이 판정의 기준 시점 */
  asOf: number;

  /** 방향 축: -1 (강한 하락) .. 0 (방향 없음) .. +1 (강한 상승) */
  trend: number;

  /** 변동성 축: 0 (평온) .. 1 (패닉) */
  volatility: number;

  /** 추세 품질(Kaufman ER): 0 (톱질) .. 1 (깨끗한 추세) */
  trendQuality: number;

  /** 명명된 국면에 대한 소프트 소속도. 합 = 1 */
  membership: Readonly<Record<RegimeLabel, number>>;

  /** 가장 유력한 라벨 (히스테리시스 적용된 하드 라벨) */
  label: RegimeLabel;

  /** 국면이 얼마나 또렷한가: 0 (애매) .. 1 (단호). 1 - 정규화 엔트로피 */
  confidence: number;
}

/** 거시·보조 시계열. 국면 판정 보조 입력 (전부 현재 시점까지) */
export interface MacroContext {
  /** ^VIX */
  vix?: PriceSeries;
  /** ^VIX3M */
  vix3m?: PriceSeries;
  // v2: breadth(200일선 위 종목 비율), 금리 스프레드 등
}

export interface RegimeClassifier {
  readonly name: string;
  readonly params: Readonly<Record<string, number>>;

  /**
   * history: 기준 지수의 "현재 시점까지" 바 배열.
   * ctx: 보조 시계열도 동일하게 현재 시점까지로 정렬되어 들어온다.
   * 미래 데이터 접근은 타입·호출 규약 수준에서 차단.
   */
  classify(history: PriceSeries, ctx?: MacroContext): RegimeState;
}
