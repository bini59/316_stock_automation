# 대시보드 — 관측·제어 표면 (Dashboards)

> 백테스트 결과를 확인·보정하는 페이지와 실거래를 모니터링하는 페이지.
> 이 둘은 **6개 레이어에 끼는 7번째 레이어가 아니라**, 트레이딩 척추 바깥에
> 붙는 **관측·제어 표면(observability surface)**이다. 엔진이 없어도/UI가
> 죽어도 매매 로직은 영향받지 않는다.

## 0. 절대 원칙 — UI는 읽고, 엔진이 결정한다

1. **매매 로직은 절대 웹에 두지 않는다.** architecture.md: "주문 실행은 명확한
   규칙으로만". 그 규칙은 엔진에 있고, 대시보드는 엔진이 뱉은 산출물을
   **읽어서 보여주는 뷰**일 뿐이다. 브라우저에서 신호·주문을 계산하지 않는다.
2. **유일한 쓰기 동작은 운영 제어.** 실거래 페이지의 버튼은 킬스위치/일시정지/
   모드 전환뿐 — "이 주문 넣어" 버튼은 없다. 제어는 엔진이 폴링하는 플래그를
   뒤집을 뿐, 엔진의 결정 권한을 가져오지 않는다.
3. **엔진은 헤드리스(CLI-first).** UI 없이도 완전히 작동한다. 웹은 선택적 표면.

## 1. 아키텍처 배치

```text
repo/
├── src/            # 엔진 (헤드리스 TS, 현재 project-structure.md 그대로)
├── web/            # Next.js 앱 (/backtest, /live 두 라우트)
└── artifacts/      # 엔진 ↔ 웹의 유일한 접점 (산출물 저장소)
    ├── backtests/  # 백테스트 결과 JSON + 실행 메타
    └── live/       # 실거래 스냅샷 + 제어 플래그
```

- **엔진과 웹의 접점은 `artifacts/`(파일/스토어) 하나.** 웹은 여기를 읽고,
  제어 플래그만 여기에 쓴다. 직접 함수 호출·공유 상태 없음 → 느슨한 결합.
- 웹은 엔진의 `types/`를 **타입으로만** import해 산출물을 타입 안전하게 읽는다
  (재구현 금지). `BacktestResult`, `AccountState`, `RegimeState` 등.
- Next.js API routes가 `artifacts/`를 읽어 페이지에 전달하고, 제어 엔드포인트가
  플래그를 쓴다. 차트는 lightweight-charts(TradingView).

## 2. 데이터 계약 — 산출물(artifacts)

### 2.1 백테스트 산출물

엔진의 백테스트 1회 실행이 남기는 것. 웹은 이걸 읽어 비교·시각화한다.

```typescript
// types/artifact.ts
import { BacktestResult } from "./result";
import { GateResult } from "./gate";   // validation/gates

export interface BacktestRun {
  id: string;
  createdAt: number;
  // 재현에 필요한 전부 (look-ahead·과최적화 추적용)
  params: Readonly<Record<string, number>>;
  universe: readonly string[];
  dateRange: { from: number; to: number };
  split: { inSampleEnd: number };        // in/out-of-sample 경계
  result: BacktestResult;                // equityCurve, trades, metrics
  oosResult?: BacktestResult;            // out-of-sample 구간 별도 결과
  gate: GateResult;                      // 합격/불합격 + 사유
  triesIndex: number;                    // 이 전략에 대해 몇 번째 시도인지
}
```

### 2.2 실거래 스냅샷

실거래 엔진이 주기적으로(예: 매 사이클) 떨구는 현재 상태.

```typescript
// types/artifact.ts
import { AccountState } from "./account";
import { RegimeState } from "./regime";
import { Order } from "./order";

export interface LiveSnapshot {
  asOf: number;
  mode: "DRY_RUN" | "LIVE_SMALL" | "LIVE";
  account: AccountState;                 // 현금·보유·NAV
  regime: RegimeState;                   // 국면 membership·label
  aggressiveness: number;                // 적극도
  targetWeights: Readonly<Record<string, number>>;
  openOrders: readonly Order[];          // 미체결
  recentDecisions: readonly string[];    // 최근 사이클 의사결정 로그
  pnl: { day: number; total: number };
}

/** 웹이 쓰는 유일한 데이터. 엔진이 폴링해서 읽고 따른다. */
export interface ControlFlags {
  killSwitch: boolean;                   // true → 즉시 DRY_RUN 강등
  paused: boolean;
  requestedMode: "DRY_RUN" | "LIVE_SMALL" | "LIVE";
  updatedAt: number;
  updatedBy: string;
}
```

## 3. 백테스트 대시보드 (`/backtest`)

결과 확인 + **보정(calibration)**. 보정이 곧 과최적화 위험지대라 validation.md
규율을 화면에 박는다.

- **성과 패널**: equity curve, 지표(샤프·MDD·승률·거래수), 거래 마커.
- **in/out-of-sample 분리 표시** — OOS 구간을 시각적으로 구분하고, **튜닝은
  in-sample 결과로만** 유도. OOS를 보며 파라미터를 고치는 행위를 막는다
  (validation.md 2번: "보는 순간 in-sample이 된다").
- **다중검정 카운터** — 이 전략에 대해 지금까지 시도한 파라미터 조합 수
  (`triesIndex`)를 크게 표시. "100개 돌리면 5개는 운으로 좋다"를 자각하게
  하고, 시도가 많을수록 게이트 기준을 더 엄격히 보정(validation.md 3번).
- **게이트 결과** — `GateResult` 합격/불합격 + 사유(gates.ts) 배지.
- **국면 타임라인** — 기간 위에 regime membership을 띠로 깔아 전략 성과와
  국면을 겹쳐 본다.
- **런 비교** — 여러 `BacktestRun`을 나란히(파라미터 diff + 성과 diff).

> 이 페이지는 **API 키 없이 지금 바로** 만들 수 있다. 엔진이 `artifacts/backtests/`에
> JSON만 떨구면 된다.

## 4. 실거래 대시보드 (`/live`)

`LiveSnapshot`을 읽어 운영 상태를 보여주고, `ControlFlags`만 쓴다.

- **포트폴리오** — 현재 보유·비중·평가손익, NAV, 현금. 목표비중 vs 현재비중 대비.
- **국면·적극도** — 현재 membership·label, 적극도 스칼라, 변동성/낙폭 브레이크 상태.
- **주문** — 미체결 주문, 최근 체결, 최근 사이클 의사결정 로그.
- **모드 배지** — DRY_RUN / LIVE_SMALL / LIVE 크게 표시(오인 방지).
- **제어(유일한 쓰기)**:
  - **킬 스위치** — 누르면 `killSwitch=true` → 엔진이 다음 폴링에서 즉시
    DRY_RUN으로 강등하고 미체결 취소.
  - 일시정지, 모드 전환 요청(`requestedMode`). 엔진이 가드 통과 시에만 승급.

> 토스 키 생기기 전엔 **mock `LiveSnapshot`으로 골격만** 세운다. 실데이터 배선은
> 키 확보 후.

## 5. 제어 채널 안전

- 엔진이 `ControlFlags`를 **매 사이클 폴링**해서 따른다. 웹이 엔진을 직접
  호출하지 않는다 → UI가 죽어도 엔진은 마지막 플래그대로 안전하게 계속.
- 킬스위치는 **fail-safe**: 플래그 읽기 실패·파일 손상 시 보수적으로 DRY_RUN.
- 제어 쓰기는 운영 동작에 한정. 종목·비중·주문을 웹에서 지정하는 경로는 없다.

## 6. 빌드 순서

1. 엔진이 `BacktestRun` 산출물을 `artifacts/`에 쓰게 한다(엔진 작업).
2. `/backtest` 페이지 — 지금 바로. (API 키 불필요)
3. `/live` 페이지 — mock 스냅샷으로 골격. 토스 배선은 키 확보 후.

## 7. 다른 문서와의 관계

- 읽는 타입의 출처: `result.ts`(BacktestResult), `account.ts`(AccountState),
  `regime.ts`(RegimeState), `order.ts`(Order), `gates.ts`(GateResult).
- 실행 모드·킬스위치·안전장치 정의: `execution-and-data.md` 1·8절.
- 보정 규율의 근거: `../strategy/validation.md`.
