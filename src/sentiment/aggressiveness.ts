/**
 * 적극도 산출 (docs/strategy/sentiment-risk.md).
 *
 * 이 레이어는 방향이 아니라 크기 — 포트폴리오 전체 gross 스케일 하나만 정한다.
 *
 * 설계 1원칙: 시스템은 AI 없이 완결된다.
 *  - 규칙 기반 베이스라인(A_base)이 단독으로 적극도를 산출한다.
 *  - AI 감성은 베이스라인 위에 얹는, 경계가 명확한 보조 오버레이일 뿐이다.
 *  - useSentiment=false / sentiment 없음 / 낡음 / 신뢰도 부족 / 예외 →
 *    조용히 베이스라인으로 강등(graceful degradation).
 *
 * look-ahead 차단: RiskInputs(realizedVol/drawdown/regime)는 전부 "현재
 * 시점까지". sentiment는 asOf가 의사결정 시점(now) 이전일 때만 반영한다.
 * 미래 감성(asOf > now)은 누출이므로 무시한다.
 *
 * 순수 함수: 같은 입력 같은 출력, 부작용 없음, 입력 불변.
 */
import { clamp } from "../indicators";
import type {
  AggressivenessConfig,
  AggressivenessResult,
  RiskInputs,
  SentimentSignal,
} from "../types/sentiment";

/**
 * 낙폭 브레이크 — 자본 보존.
 *   dd < 0.10           → 1.0   (무감쇠)
 *   0.10 ≤ dd < 0.30    → 1 − (dd − 0.10) / 0.20  (선형 감쇠)
 *   dd ≥ 0.30           → 0.0   (전량 현금)
 */
export function ddBrake(drawdown: number): number {
  const dd = Math.max(0, drawdown);
  if (dd < 0.1) return 1.0;
  if (dd >= 0.3) return 0.0;
  return 1 - (dd - 0.1) / 0.2;
}

/**
 * 변동성 타겟팅 — 핵심 리스크 엔진.
 * A_vol = clamp(targetVol / realizedVol, 0, maxExposure).
 * realizedVol=0(또는 음수) 방어: 0 나눗셈을 피하고 maxExposure로 클램프.
 */
function volTarget(
  targetVol: number,
  realizedVol: number,
  maxExposure: number,
): number {
  if (!(realizedVol > 0)) return maxExposure; // NaN/0/음수 → 상한
  return clamp(targetVol / realizedVol, 0, maxExposure);
}

/**
 * 감성 오버레이가 유효한지 판정하고 보정율(adj)을 산출한다.
 * 무효면 { adj: 1, reason } 을 돌려 베이스라인만 쓰게 한다.
 */
function sentimentAdjustment(
  cfg: AggressivenessConfig,
  sentiment: SentimentSignal | undefined,
  now: number | undefined,
): { adj: number; reason: string } {
  if (!cfg.useSentiment) return { adj: 1, reason: "sentiment off" };
  if (sentiment === undefined) return { adj: 1, reason: "no sentiment" };

  // 신선도·look-ahead 판단에는 now가 필요. 없으면 안전하게 무시.
  if (now === undefined) {
    return { adj: 1, reason: "no decision time, sentiment ignored" };
  }

  // look-ahead 차단: 미래 감성(asOf > now)은 누출 → 무시.
  if (sentiment.asOf > now) {
    return { adj: 1, reason: "sentiment from future (look-ahead), ignored" };
  }

  // 신선도 초과: 낡은 감성 무시.
  if (now - sentiment.asOf > cfg.freshnessMs) {
    return { adj: 1, reason: "sentiment stale" };
  }

  if (sentiment.confidence < cfg.minConfidence) {
    return { adj: 1, reason: "sentiment confidence below minimum" };
  }

  // 신뢰도 가중 유효 점수, -1..+1 범위로 안전 클램프.
  const sEff = clamp(sentiment.score * sentiment.confidence, -1, 1);

  // 비대칭: 키우는 건 작게(+boost), 줄이는 건 크게(−cut).
  const adj =
    sEff >= 0
      ? 1 + cfg.sentimentMaxBoost * sEff
      : 1 + cfg.sentimentMaxCut * sEff;

  const dir = sEff >= 0 ? "boost" : "cut";
  return { adj, reason: `sentiment ${dir} ${adj.toFixed(4)}` };
}

/**
 * 적극도 산출 순수 함수 (ComputeAggressiveness 구현).
 *
 * base   = clamp(A_vol × A_crisis × A_dd, 0, maxExposure)
 * A      = clamp(base × adj, 0, maxExposure)
 *
 * useSentiment=false / sentiment undefined / 신선도 초과 / 미래 누출 /
 * confidence 부족 → adj=1 (base 그대로). reasons에 사유 기록.
 */
export const computeAggressiveness = (
  risk: RiskInputs,
  cfg: AggressivenessConfig,
  sentiment?: SentimentSignal,
  now?: number,
): AggressivenessResult => {
  const reasons: string[] = [];

  // ── 규칙 베이스라인 (세 브레이크의 곱) ──
  const aVol = volTarget(cfg.targetVol, risk.realizedVol, cfg.maxExposure);
  const aCrisis = clamp(1 - risk.regime.membership.crisis, 0, 1);
  const aDd = ddBrake(risk.drawdown);

  const base = clamp(aVol * aCrisis * aDd, 0, cfg.maxExposure);

  reasons.push(`vol-target ${aVol.toFixed(4)}`);
  reasons.push(`crisis-brake ${aCrisis.toFixed(4)}`);
  reasons.push(`dd-brake ${aDd.toFixed(4)}`);

  // ── AI 감성 오버레이 (경계 있는 보조) ──
  const { adj, reason } = sentimentAdjustment(cfg, sentiment, now);
  reasons.push(reason);

  const aggressiveness = clamp(base * adj, 0, cfg.maxExposure);

  return {
    aggressiveness,
    base,
    sentimentApplied: adj,
    reasons,
  };
};
