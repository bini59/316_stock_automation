/**
 * 전략 계약 (docs/coding/interfaces.md + docs/strategy/strategy-pool.md).
 *
 * - `Strategy`: 단일종목 원자(atom). `next(history)`에 현재 시점까지만 노출.
 * - `RegimeStrategy`: 유니버스 단위로 동작하는 한 단계 위 계약(전략 풀용).
 *
 * look-ahead 차단: history/universe는 모두 "현재 시점까지" 슬라이스.
 */
import type { PriceSeries } from "./market";
import type { RegimeLabel, RegimeState } from "./regime";

export type SignalAction = "BUY" | "SELL" | "HOLD";

export interface Signal {
  action: SignalAction;
  /** 0~1, 포지션 크기 비중. 메타/적극도 레이어가 나중에 조절 */
  strength: number;
}

export interface Strategy {
  readonly name: string;

  /**
   * 핵심 규칙: history는 "현재 시점까지"만 담긴 배열.
   * 미래 데이터는 타입 수준에서 아예 접근 불가하게 만든다.
   */
  next(history: PriceSeries): Signal;

  /** 파라미터를 외부에서 주입 (최적화 루프가 갈아끼움) */
  readonly params: Readonly<Record<string, number>>;
}

/** 유니버스: 심볼 → "현재 시점까지" 바 배열 (look-ahead 차단) */
export type UniverseHistory = Readonly<Record<string, PriceSeries>>;

/** 전략 한 개의 제안: 종목별 전략-내부 상대비중 (합 ≤ 1, 나머지는 전략-내 현금) */
export interface StrategyProposal {
  readonly strategy: string;
  /** 0..1, 국면 기반 활성도 */
  readonly activation: number;
  /** 심볼 → 0..1 */
  readonly weights: Readonly<Record<string, number>>;
  /**
   * 전략의 패밀리. 메타 레이어의 패밀리 예산 상한 계산에 쓰인다.
   * runPool이 RegimeStrategy.family를 그대로 실어 보낸다(이름 추론 대체).
   */
  readonly family?: StrategyFamily;
}

export type StrategyFamily = "trend" | "meanrev" | "defensive" | "cash";

export interface RegimeStrategy {
  readonly name: string;
  readonly family: StrategyFamily;
  readonly regimeAffinity: Readonly<Partial<Record<RegimeLabel, number>>>;
  readonly params: Readonly<Record<string, number>>;

  /** 유니버스 전체의 현재까지 데이터 + 국면 상태 → 전략-내부 목표비중 */
  propose(universe: UniverseHistory, regime: RegimeState): Record<string, number>;
}
