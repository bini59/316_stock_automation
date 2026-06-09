/**
 * 히스테리시스 — whipsaw 3중 방어 중 2·3차 (docs/strategy/regime.md 6절).
 *
 *  - 입력 EMA 평활: trend·volatility 축을 멤버십 계산 전에 EMA(span)로 평활.
 *    (classifier가 emaSeries로 축 시계열을 평활해 넘긴다)
 *  - 하드 라벨 슈미트 트리거 + 체류시간: argmax 라벨 전환을 끈끈하게.
 *
 * 라벨 도출은 무상태여야 한다 — 멤버십 경로 전체를 처음부터 walk해 재현.
 */
import type { RegimeLabel } from "../types/regime";
import { argmaxLabel } from "./membership";

/** 히스테리시스 파라미터 (regime.md 7절). */
export interface HysteresisParams {
  /** 라벨 진입 임계(새 후보 membership > enter) */
  enter: number;
  /** 라벨 이탈 임계(현재 라벨 membership < exit) */
  exit: number;
  /** 라벨 체류(새 후보가 K일 연속 1위 유지) */
  dwellK: number;
}

/**
 * 멤버십 시계열을 처음부터 walk하며 슈미트 트리거 + 체류로 하드 라벨을 도출.
 * 마지막 시점의 하드 라벨을 반환한다(무상태: 같은 시계열이면 항상 같은 결과).
 *
 * 규칙(regime.md 6절):
 *   - 전환 후보 = 매 시점 argmax 라벨.
 *   - 후보가 현재 라벨과 다르고, 후보 membership > enter AND 현재 라벨
 *     membership < exit 인 시점에서 "전환 자격"이 생긴다.
 *   - 그 자격이 dwellK일 연속(같은 후보가 계속 1위) 유지되면 라벨을 전환.
 *   - 조건이 깨지면 카운터 리셋.
 *
 * 빈 시계열이면 "chop"을 기본 라벨로 둔다(데이터 부족 시 중립).
 */
export function deriveHardLabel(
  membershipSeries: ReadonlyArray<Record<RegimeLabel, number>>,
  params: HysteresisParams,
): RegimeLabel {
  if (membershipSeries.length === 0) return "chop";

  // 초기 라벨: 첫 시점 argmax(워밍업 — 히스테리시스 시작점).
  let current: RegimeLabel = argmaxLabel(membershipSeries[0]!);
  let candidate: RegimeLabel | null = null;
  let streak = 0;

  for (let i = 1; i < membershipSeries.length; i++) {
    const m = membershipSeries[i]!;
    const top = argmaxLabel(m);

    const qualifies = top !== current && m[top] > params.enter && m[current] < params.exit;

    if (qualifies) {
      if (candidate === top) {
        streak += 1;
      } else {
        candidate = top;
        streak = 1;
      }
      if (streak >= params.dwellK) {
        current = top;
        candidate = null;
        streak = 0;
      }
    } else {
      // 자격 상실 → 후보 카운터 리셋.
      candidate = null;
      streak = 0;
    }
  }

  return current;
}
