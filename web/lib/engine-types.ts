/**
 * 엔진 타입 계약의 단일 재노출 지점 (읽기 전용 경계면).
 *
 * 절대 원칙(dashboards.md 0절): 대시보드는 엔진 산출물의 뷰일 뿐.
 * 여기서는 `src/types/`를 **타입으로만** 가져온다(`import type`).
 * 런타임 코드는 단 한 줄도 가져오지 않으므로 컴파일 시 전부 소거된다 → 엔진
 * 구현에 대한 런타임 결합 0. shape 재구현 금지.
 *
 * 생산자(engine/execution)가 src/types/* 를 바꾸면 이 파일을 통해 전 컴포넌트가
 * 동시에 타입 깨짐을 보고한다 = 경계면 불일치 조기 탐지.
 */
export type {
  BacktestRun,
  LiveSnapshot,
  ControlFlags,
  RegimeTimelinePoint,
} from "../../src/types/artifact";

// 튜닝 산출물(엔진 pipeline). 웹은 비교 테이블을 그리기 위해 읽기만 한다.
export type { TuningArtifact } from "../../src/pipeline/writeArtifact";
export type { TuneResult, TuneParams } from "../../src/pipeline/tune";

export type { BacktestResult, Trade, Metrics } from "../../src/types/result";

export type { GateResult, GateCriteria } from "../../src/types/gate";

export type {
  AccountState,
  Holding,
} from "../../src/types/account";

export type {
  RegimeState,
  RegimeLabel,
} from "../../src/types/regime";

export type { Order, OrderResult } from "../../src/types/order";

export type { LiveMode, ExecMode } from "../../src/types/broker-port";
