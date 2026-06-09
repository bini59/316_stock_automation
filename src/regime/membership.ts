/**
 * 연속 축 산출 + 소프트 멤버십 계산 (docs/strategy/regime.md 5절).
 *
 * 멤버십이 이 레이어의 핵심 계약. 하드 경계 없이 합=1로 정규화된 소속도를
 * 만들어 whipsaw를 구조적으로 죽인다. 모든 입력은 trailing 신호에서 온다.
 */
import type { RegimeLabel } from "../types/regime";
import { sigmoid, clamp, normalizedEntropy } from "../indicators";

/** 멤버십 계산 파라미터 (regime.md 7절). */
export interface MembershipParams {
  /** trend 가중: d200 */
  wD: number;
  /** trend 가중: slope200 */
  wS: number;
  /** trend 압축(tanh 기울기) */
  kT: number;
  /** crisis 임계(변동성) */
  crisisC: number;
  /** crisis 폭(sigmoid 완만도) */
  crisisS: number;
}

/** 멤버십 계산에 들어가는 연속 축. */
export interface RegimeAxes {
  /** -1..+1 */
  trend: number;
  /** 0..1 */
  volatility: number;
  /** 0..1 (Kaufman ER) */
  trendQuality: number;
}

/**
 * z표준화된 trend 원시값으로부터 연속 trend 축(-1..+1)을 만든다.
 * trendRaw = wD·z(d200) + wS·z(slope200), trend = tanh(kT·trendRaw).
 * 한쪽 z가 없으면 가용한 쪽만 가중(둘 다 없으면 0).
 */
export function computeTrend(
  zD200: number | undefined,
  zSlope200: number | undefined,
  params: MembershipParams,
): number {
  let raw = 0;
  let wSum = 0;
  if (zD200 !== undefined) {
    raw += params.wD * zD200;
    wSum += params.wD;
  }
  if (zSlope200 !== undefined) {
    raw += params.wS * zSlope200;
    wSum += params.wS;
  }
  if (wSum === 0) return 0;
  // 가용 가중으로 재정규화(한쪽만 있을 때 스케일 보존).
  const normalized = raw / wSum;
  return Math.tanh(params.kT * normalized * (params.wD + params.wS));
}

/**
 * 변동성 축(0..1): clamp(0.5·rvPct + 0.4·vixPct + 0.1·termStress, 0, 1).
 * 가용 성분만 가중하고 가중합으로 재정규화(누락 성분을 0으로 끌어내리지 않음).
 */
export function computeVolatility(
  rvPct: number | undefined,
  vixPct: number | undefined,
  termStress: number | undefined,
): number {
  const parts: Array<[number, number]> = [];
  if (rvPct !== undefined) parts.push([0.5, rvPct]);
  if (vixPct !== undefined) parts.push([0.4, vixPct]);
  if (termStress !== undefined) parts.push([0.1, termStress]);
  if (parts.length === 0) return 0;
  let wSum = 0;
  let acc = 0;
  for (const [w, v] of parts) {
    wSum += w;
    acc += w * v;
  }
  return clamp(acc / wSum, 0, 1);
}

function pos(x: number): number {
  return Math.max(0, x);
}

function hi(v: number, c: number, s: number): number {
  return sigmoid((v - c) / s);
}

/**
 * 소프트 멤버십 (regime.md 5.2 어피니티 공식 그대로). 합 = 1.
 *
 *   a_crisis = hi(vol, c, s) · (1 + 0.5·pos(−trend))
 *   a_bull   = pos(trend) · (1 − vol) · (0.5 + 0.5·ER)
 *   a_bear   = pos(−trend) · (1 − a_crisis)
 *   a_chop   = (1 − |trend|) · (1 − ER) · (1 − a_crisis)
 */
export function computeMembership(
  axes: RegimeAxes,
  params: MembershipParams,
): Record<RegimeLabel, number> {
  const { trend, volatility, trendQuality: er } = axes;

  // 하락 시 crisis 증폭자가 1을 넘길 수 있다(0.5·pos(−trend)). 그러면 (1−aCrisis)가
  // 음수가 되어 bear/chop 어피니티가 음수로 깨진다. crisis "억제 강도"로 쓰는 값은
  // [0,1]로 클램프해 비음(非負)을 보장한다(어피니티는 비음이어야 정규화가 확률).
  const aCrisis = clamp(hi(volatility, params.crisisC, params.crisisS) * (1 + 0.5 * pos(-trend)), 0, 1);
  const aBull = pos(trend) * (1 - volatility) * (0.5 + 0.5 * er);
  const aBear = pos(-trend) * (1 - aCrisis);
  const aChop = (1 - Math.abs(trend)) * (1 - er) * (1 - aCrisis);

  const total = aBull + aBear + aChop + aCrisis;

  // 모든 어피니티가 사실상 0이면(예: |trend|=1로 chop이 0, 추세 부호 탓에
  // bull/bear 한쪽이 0, 변동성 낮아 crisis 0) 멤버십을 정의할 수 없다.
  // 중립(chop=1)으로 graceful 강등 — 합=1 계약을 깨지 않는다.
  if (total < 1e-9) {
    return { bull: 0, bear: 0, chop: 1, crisis: 0 };
  }

  return {
    bull: aBull / total,
    bear: aBear / total,
    chop: aChop / total,
    crisis: aCrisis / total,
  };
}

/**
 * confidence = 1 − normalizedEntropy(membership) / log(4).
 * normalizedEntropy가 이미 log(k)로 정규화하므로 그 결과를 1에서 뺀다.
 * 0(균등=애매) .. 1(한 곳 집중=단호).
 */
export function computeConfidence(membership: Record<RegimeLabel, number>): number {
  const probs = [membership.bull, membership.bear, membership.chop, membership.crisis];
  return clamp(1 - normalizedEntropy(probs), 0, 1);
}

/** membership에서 argmax 라벨(동률이면 고정 우선순위 crisis>bear>bull>chop). */
export function argmaxLabel(membership: Record<RegimeLabel, number>): RegimeLabel {
  const order: RegimeLabel[] = ["crisis", "bear", "bull", "chop"];
  let best: RegimeLabel = "chop";
  let bestVal = -Infinity;
  for (const label of order) {
    if (membership[label] > bestVal) {
      bestVal = membership[label];
      best = label;
    }
  }
  return best;
}
