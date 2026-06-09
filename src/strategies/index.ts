/**
 * 전략 풀 배럴 (TODO 4.2).
 *
 * 국면별 전략 풀: 추세(bull)·평균회귀(chop)·방어(bear)·현금(crisis).
 * 각 전략은 RegimeStrategy를 구현하고, runPool이 활성도를 태그해 메타로 넘긴다.
 */
export { runPool, activationOf, ACTIVATION_EPS } from "./pool";
export {
  equalWeight,
  inverseVolWeight,
  scoreWeight,
  capSum,
  sumWeights,
} from "./weights";

export {
  TimeSeriesMomentum,
  CrossSectionalMomentum,
  DualMomentum,
  trendStrategies,
} from "./trend";

export {
  ZScoreReversion,
  RsiReversion,
  BollingerReversion,
  meanRevStrategies,
} from "./meanrev";

export {
  LowVolTilt,
  DefensiveSectorRotation,
  CashRaise,
  defensiveStrategies,
} from "./defensive";

export { AllCash, cashStrategies } from "./cash";

import type { RegimeStrategy } from "../types/strategy";
import { trendStrategies } from "./trend";
import { meanRevStrategies } from "./meanrev";
import { defensiveStrategies } from "./defensive";
import { cashStrategies } from "./cash";

/** 4개 패밀리 전체의 기본 전략 풀. */
export function defaultStrategyPool(): RegimeStrategy[] {
  return [
    ...trendStrategies(),
    ...meanRevStrategies(),
    ...defensiveStrategies(),
    ...cashStrategies(),
  ];
}
