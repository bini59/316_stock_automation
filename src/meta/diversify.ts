/**
 * 메타 배분 v2 — 상관 기반 다양화 (TODO 4.4.4, 교체 가능).
 * 설계: docs/strategy/meta-allocation.md 3절 v2.
 *
 * 전략 수익률 시계열(trailing window)로 상관/변동성을 추정해 진짜 다양화를 한다.
 * v1과 동일 인터페이스로 끼워 A/B 한다.
 *
 * ★ look-ahead 절대 차단: 상관·변동성은 strategyReturns(과거 실현 수익률)로만
 *   추정한다. 미래 구간을 절대 인덱싱하지 않는다. correlationLookback이 주어지면
 *   배열의 **끝(최근)** 에서 그만큼만 잘라 쓴다(trailing slice). prefix만 늘어나도
 *   기존 구간의 추정은 불변이어야 한다(prefix 불변성).
 * ★ 성과 추종 금지: 최근 수익률의 "부호/크기"로 자본을 몰아주지 않는다.
 *   배분의 magnitude는 확신(activation), 상관/변동성은 **다양화 보정**으로만 쓴다.
 *   → 같은 입력에서 수익률 시계열의 부호를 뒤집어도 배분이 바뀌지 않는다(상관·σ 불변).
 */
import { clamp, pearson, stddev } from "../indicators";
import type { AllocationConfig } from "../types/allocation";
import type { StrategyProposal } from "../types/strategy";

/** correlationLookback이 있으면 최근 구간만 자른다(trailing). 없으면 전체. */
function trailing(xs: readonly number[], lookback?: number): readonly number[] {
  if (typeof lookback === "number" && lookback > 0 && xs.length > lookback) {
    return xs.slice(xs.length - lookback);
  }
  return xs;
}

/** 두 전략 수익률의 상관(겹치는 최근 구간 기준). 데이터 부족이면 0(상관 없음 가정). */
function corr(a: readonly number[], b: readonly number[]): number {
  return pearson(a, b);
}

/**
 * v2 전략 간 base 산출. method:
 *  - "riskparity": base ∝ (1/σ) × activation, 상관 페널티로 추가 감쇠.
 *  - "hrp":        (소표본 견고형) 현재는 상관 페널티 다양화로 근사.
 *
 * 공통 다양화: avgCorr[s] = 다른 전략들과의 평균 양의 상관 → base *= (1 − avgCorr).
 * 상관 높은 전략(중복 베팅)일수록 자본이 깎인다. magnitude는 activation에 비례.
 *
 * 반환은 정규화 전 base(양수). 데이터가 모자란 전략은 activation만으로 폴백.
 */
export function diversifiedBase(
  candidates: readonly StrategyProposal[],
  strategyReturns: Readonly<Record<string, readonly number[]>>,
  cfg: AllocationConfig,
  reasons: string[],
): Record<string, number> {
  const names = candidates.map((p) => p.strategy);
  const lookback = cfg.correlationLookback;

  // 전략별 trailing 수익률 (없으면 빈 배열)
  const rets: Record<string, readonly number[]> = {};
  for (const name of names) {
    rets[name] = trailing(strategyReturns[name] ?? [], lookback);
  }

  // 평균 양의 상관 (다양화 페널티)
  const avgCorr: Record<string, number> = {};
  for (const a of names) {
    const ra = rets[a]!;
    let acc = 0;
    let cnt = 0;
    for (const b of names) {
      if (a === b) continue;
      const rb = rets[b]!;
      if (ra.length < 2 || rb.length < 2) continue;
      acc += Math.max(0, corr(ra, rb)); // 양의 상관만 페널티(음의 상관은 다양화 이득)
      cnt++;
    }
    avgCorr[a] = cnt > 0 ? acc / cnt : 0;
  }

  const useRiskParity = cfg.method === "riskparity";
  const base: Record<string, number> = {};
  let anyEstimated = false;

  for (const p of candidates) {
    const name = p.strategy;
    const activation = Math.max(0, p.activation);
    const r = rets[name]!;

    // 리스크 패리티: 변동성 역가중. σ 추정 불가면 1(중립).
    let invVol = 1;
    if (useRiskParity && r.length >= 2) {
      const sd = stddev(r);
      if (sd > 0) {
        invVol = 1 / sd;
        anyEstimated = true;
      }
    }

    // 상관 페널티: 다른 전략과 양의 상관이 높을수록 감쇠. [0,1]로 클립.
    const ac = avgCorr[name] ?? 0;
    const corrFactor = clamp(1 - ac, 0, 1);
    if (ac > 0) anyEstimated = true;

    base[name] = activation * invVol * corrFactor;
  }

  // 리스크 패리티에서 σ 스케일이 들어가면 전략 간 절대 크기가 의미 없으므로,
  // activation 비례 의미를 보존하기 위해 평균 σ로 정규화(상대 비중만 정규화 단계에서 결정).
  if (useRiskParity) {
    reasons.push("v2 riskparity diversification");
  } else {
    reasons.push(`v2 ${cfg.method} correlation diversification`);
  }

  // 전부 0이면(전략 1개거나 추정 불가로 corrFactor=1, activation=0 등) activation 폴백
  const total = Object.values(base).reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (total <= 0 || !anyEstimated) {
    const fb: Record<string, number> = {};
    for (const p of candidates) fb[p.strategy] = Math.max(0, p.activation);
    if (!anyEstimated) reasons.push("v2 insufficient returns: activation base");
    return fb;
  }

  return base;
}
