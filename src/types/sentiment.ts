/**
 * 감성·리스크 → 적극도 계약 (docs/strategy/sentiment-risk.md).
 *
 * 이 레이어는 방향이 아니라 크기(전체 gross 스케일)만 조절한다.
 * 규칙 베이스라인이 단독으로 적극도를 산출하고, AI 감성은 경계 있는
 * 보조 오버레이. sentiment가 없어도/꺼져도/실패해도 정상 작동(1급 모드).
 */
import type { RegimeState } from "./regime";

/** AI(LLM)가 산출하는 감성 신호 — 이 레이어의 유일한 AI 입력 */
export interface SentimentSignal {
  /** -1 (극도 부정) .. +1 (극도 긍정) */
  score: number;
  /** 0..1, 근거의 강도 */
  confidence: number;
  /** Unix epoch (ms), 신선도 판단용 */
  asOf: number;
  /** 근거 기사·공시 수 (선택, 로깅용) */
  sources?: number;
}

/** 적극도 산출에 필요한 정량 리스크 입력 (전부 현재 시점까지) */
export interface RiskInputs {
  /** 연율화 실현변동성 */
  realizedVol: number;
  /** 현재 낙폭 0..1 */
  drawdown: number;
  /** crisis 멤버십 등 */
  regime: RegimeState;
}

export interface AggressivenessConfig {
  /** 예: 0.12 */
  targetVol: number;
  /** 보통 1.0 (무레버리지) */
  maxExposure: number;
  /** false → AI 완전 배제 (1급 모드) */
  useSentiment: boolean;
  /** 예: 0.15 (비대칭 상방) */
  sentimentMaxBoost: number;
  /** 예: 0.30 (비대칭 하방) */
  sentimentMaxCut: number;
  /** 이 시간(ms) 지난 감성은 중립 처리 */
  freshnessMs: number;
  /** 예: 0.2 */
  minConfidence: number;
}

export interface AggressivenessResult {
  /** 최종 gross 스케일 0..maxExposure */
  aggressiveness: number;
  /** AI 빼고 규칙만으로 산출한 값 */
  base: number;
  /** 실제 반영된 감성 보정율 (1.0이면 미반영) */
  sentimentApplied: number;
  /** "vol-target 0.5", "sentiment stale" 등 설명 */
  reasons: string[];
}

/**
 * 적극도 산출 순수 함수의 시그니처.
 * 구현은 src/sentiment/aggressiveness.ts. sentiment가 undefined여도,
 * useSentiment=false여도 base를 그대로 반환한다.
 */
export type ComputeAggressiveness = (
  risk: RiskInputs,
  cfg: AggressivenessConfig,
  sentiment?: SentimentSignal,
  now?: number,
) => AggressivenessResult;
