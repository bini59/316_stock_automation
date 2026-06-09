/**
 * 실행 모드 해석·승급 가드 (execution-and-data.md 1·8절).
 *
 * ControlFlags(킬스위치·일시정지·요청모드)와 현재 모드를 받아 *유효 모드*를 결정한다.
 * - killSwitch → 즉시 DRY_RUN 강등 (가장 강한 가드).
 * - paused → 주문을 내지 않도록 DRY_RUN 강등(계산은 계속).
 * - requestedMode 승급은 한 단계씩만 허용(BACKTEST→...→LIVE 순). 강등은 항상 허용.
 */
import type { ExecMode, LiveMode } from "../types/broker-port";
import type { ControlFlags } from "../types/artifact";

/** 승급 순서. 인덱스가 클수록 위험. */
const LADDER: readonly ExecMode[] = ["BACKTEST", "DRY_RUN", "LIVE_SMALL", "LIVE"];

function rank(mode: ExecMode): number {
  return LADDER.indexOf(mode);
}

/** 한 단계 위 모드 (없으면 자신). 점프 승급 방지 */
export function nextStepUp(mode: LiveMode): LiveMode {
  const idx = rank(mode);
  const next = LADDER[Math.min(idx + 1, LADDER.length - 1)];
  // BACKTEST는 LiveMode가 아니므로 사다리는 DRY_RUN 이상에서만 동작
  return (next === "BACKTEST" ? "DRY_RUN" : next) as LiveMode;
}

export interface ResolveModeResult {
  readonly mode: LiveMode;
  readonly reason: string;
}

/**
 * 현재 모드와 ControlFlags로 유효 모드를 결정한다.
 *
 * 우선순위: killSwitch > paused > requestedMode(한 단계 승급 가드).
 * 강등(낮은 위험 모드로)은 언제나 즉시 허용.
 */
export function resolveMode(current: LiveMode, flags: ControlFlags): ResolveModeResult {
  if (flags.killSwitch) {
    return { mode: "DRY_RUN", reason: "killSwitch → DRY_RUN 강등" };
  }
  if (flags.paused) {
    return { mode: "DRY_RUN", reason: "paused → DRY_RUN 강등(주문 미제출)" };
  }

  const requested = flags.requestedMode;
  const reqRank = rank(requested);
  const curRank = rank(current);

  // 강등 요청: 즉시 허용
  if (reqRank <= curRank) {
    return { mode: requested, reason: `요청 모드 ${requested} 적용(강등/유지)` };
  }

  // 승급 요청: 한 단계만 허용
  const capped = nextStepUp(current);
  if (rank(requested) > rank(capped)) {
    return {
      mode: capped,
      reason: `점프 승급 차단: ${current}→${capped}만 허용(요청 ${requested})`,
    };
  }
  return { mode: requested, reason: `한 단계 승급 ${current}→${requested}` };
}
