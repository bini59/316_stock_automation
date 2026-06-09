/**
 * 평균회귀 패밀리 (TODO 4.2.3, docs/strategy/strategy-pool.md 5.2).
 *
 * ★ 핵심 가설/안전장치: 평균회귀는 추세장에서 "칼받기"가 된다.
 *   1) 국면 게이트: affinity { chop: 1.0 }, bull/bear/crisis ≈ 0 → 톱질장에서만 활성.
 *      (활성도는 pool이 강제하지만, propose 자체도 chop 멤버십이 약하면 비중을 줄여
 *       이중 방어한다.)
 *   2) 200일선 위 과매도만 매수(requireAboveTrend=1) → 추세 역행(하락 추세에서
 *      과매도 칼받기) 금지. propose 단계에서 막는다.
 *
 * ★ look-ahead: zScore/rsi/bollinger 전부 trailing. 미래 미참조.
 * ★ 무상태·순수.
 *
 * 주간 리밸런싱·롱-온리 가정이므로 "청산"은 보유 종목을 후보에서 제외하는 것으로
 * 자연 구현된다(weights에 안 들어가면 다음 리밸런싱에 비중 0 → 정산).
 */
import type {
  RegimeStrategy,
  UniverseHistory,
} from "../types/strategy";
import type { RegimeLabel, RegimeState } from "../types/regime";
import { closesOf, zScore, rsi, bollinger, distanceFromSma } from "../indicators";
import { equalWeight } from "./weights";

const MEANREV_AFFINITY: Readonly<Partial<Record<RegimeLabel, number>>> = {
  chop: 1.0,
  // bull/bear/crisis는 명시하지 않음 → 활성도 0(국면 게이트).
};

/**
 * 추세 역행 금지 필터: requireAboveTrend면 200일선 위 종목만 통과.
 * 200일선 아래(하락 추세) 종목의 과매도는 매수하지 않는다(칼받기 방지).
 */
function trendGateOk(
  closes: number[],
  smaWindow: number,
  requireAboveTrend: boolean,
): boolean {
  if (!requireAboveTrend) return true;
  const dist = distanceFromSma(closes, smaWindow);
  return dist !== undefined && dist > 0;
}

/**
 * z-스코어 회귀: z = (close − SMA_w)/σ_w. z < entry 매수, z ≥ exit 청산.
 * 과매도(z 음수)일수록 매수 후보. 동일가중.
 */
export class ZScoreReversion implements RegimeStrategy {
  readonly name = "meanrev-zscore";
  readonly family = "meanrev" as const;
  readonly regimeAffinity = MEANREV_AFFINITY;
  readonly params: Readonly<Record<string, number>>;

  constructor(params: Partial<Record<string, number>> = {}) {
    this.params = {
      window: 20,
      entryZ: -1,
      smaWindow: 200,
      requireAboveTrend: 1,
      ...params,
    };
  }

  propose(universe: UniverseHistory, _regime: RegimeState): Record<string, number> {
    const { window, entryZ, smaWindow, requireAboveTrend } = this.params;
    const buys: string[] = [];
    for (const [symbol, series] of Object.entries(universe)) {
      const closes = closesOf(series);
      if (!trendGateOk(closes, smaWindow!, requireAboveTrend! >= 0.5)) continue;
      const z = zScore(closes, window!);
      if (z !== undefined && z < entryZ!) buys.push(symbol);
    }
    return equalWeight(buys);
  }
}

/**
 * RSI(2) 회귀(Connors 스타일): RSI(2) < entry 매수, > exit 청산.
 * 단기 과매도 반등. 동일가중.
 */
export class RsiReversion implements RegimeStrategy {
  readonly name = "meanrev-rsi2";
  readonly family = "meanrev" as const;
  readonly regimeAffinity = MEANREV_AFFINITY;
  readonly params: Readonly<Record<string, number>>;

  constructor(params: Partial<Record<string, number>> = {}) {
    this.params = {
      period: 2,
      entryRsi: 10,
      smaWindow: 200,
      requireAboveTrend: 1,
      ...params,
    };
  }

  propose(universe: UniverseHistory, _regime: RegimeState): Record<string, number> {
    const { period, entryRsi, smaWindow, requireAboveTrend } = this.params;
    const buys: string[] = [];
    for (const [symbol, series] of Object.entries(universe)) {
      const closes = closesOf(series);
      if (!trendGateOk(closes, smaWindow!, requireAboveTrend! >= 0.5)) continue;
      const r = rsi(closes, period!);
      if (r !== undefined && r < entryRsi!) buys.push(symbol);
    }
    return equalWeight(buys);
  }
}

/**
 * 볼린저 회귀: 하단 밴드 터치(pctB ≤ touch) 매수, 중심선 회귀 시 청산.
 * 밴드폭으로 변동성 적응. 동일가중.
 */
export class BollingerReversion implements RegimeStrategy {
  readonly name = "meanrev-bollinger";
  readonly family = "meanrev" as const;
  readonly regimeAffinity = MEANREV_AFFINITY;
  readonly params: Readonly<Record<string, number>>;

  constructor(params: Partial<Record<string, number>> = {}) {
    this.params = {
      window: 20,
      k: 2,
      touchPctB: 0,
      smaWindow: 200,
      requireAboveTrend: 1,
      ...params,
    };
  }

  propose(universe: UniverseHistory, _regime: RegimeState): Record<string, number> {
    const { window, k, touchPctB, smaWindow, requireAboveTrend } = this.params;
    const buys: string[] = [];
    for (const [symbol, series] of Object.entries(universe)) {
      const closes = closesOf(series);
      if (!trendGateOk(closes, smaWindow!, requireAboveTrend! >= 0.5)) continue;
      const b = bollinger(closes, window!, k!);
      if (b !== undefined && b.pctB <= touchPctB!) buys.push(symbol);
    }
    return equalWeight(buys);
  }
}

/** 기본 평균회귀 전략 묶음. */
export function meanRevStrategies(): RegimeStrategy[] {
  return [new ZScoreReversion(), new RsiReversion(), new BollingerReversion()];
}
