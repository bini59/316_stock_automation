---
name: quant-engine-build
description: "백테스트 엔진·검증 프레임워크·공통 타입 계약을 구현하는 절차. 시뮬레이션 루프, Broker 비용 모델(US/KR), 워크포워드, 지표(샤프·MDD), 합격 게이트, look-ahead 타입 차단, BacktestRun artifact 산출. 엔진/백테스터/검증/types/ 작업을 시작하면 반드시 이 스킬을 사용할 것. 전략보다 먼저 신뢰 가능하게 만들어야 하는 토대 작업."
---

# Quant Engine Build — 검증 가능한 토대 구축 절차

이 프로젝트의 1순위 원칙은 "전략 알고리즘보다 검증 프레임워크를 먼저 신뢰
가능하게 만든다"이다. 그 이유는 백테스트가 거짓말(과최적화·look-ahead·비용
누락)을 하기 때문이며, 그 거짓말을 거를 장치가 없으면 어떤 전략도 믿을 수 없다.

## 작업 순서 (의존 역순으로 토대부터)

1. **타입 계약**(`src/types/`) 먼저. 모든 레이어가 여기에만 의존한다.
2. **Broker 비용 모델**(`src/engine/broker.ts`) — 비용을 구조적으로 강제.
3. **백테스터 루프**(`src/engine/backtester.ts`) + `portfolio`.
4. **지표·게이트·워크포워드**(`src/validation/`).
5. **BacktestRun artifact** 산출(`artifacts/backtests/`).

## 타입 계약 원칙

설계 원본은 `docs/coding/interfaces.md`와 각 레이어 문서다. 계약을 새로 짜지 말고
문서의 타입을 구현한다. 핵심 타입: `Bar`/`PriceSeries`, `Signal`/`Strategy`,
`Trade`/`Metrics`/`BacktestResult`, `RegimeState`, `StrategyProposal`,
`MetaAllocation`, `AggressivenessResult`, `AccountState`, `Order`, `BacktestRun`.

타입은 **레이어 간 유일한 결합점**이므로, 변경 시 영향받는 레이어를 먼저 파악하고
팀원에게 알린 뒤 바꾼다. 한 파일에 한 관심사(market/strategy/result/regime/...).

## look-ahead 차단 (타입 + 루프)

백테스터는 매 시점 `data.slice(0, i + 1)`로 "현재까지"만 전략에 넘긴다. 이렇게
하면 전략 코드가 미래를 볼 **방법 자체가 없다**. 이게 1차 방어선이고, 검증
프레임워크의 모든 trailing 통계(백분위·평활·상관)도 같은 규율을 따른다.

단위 테스트로 못 박는다: "i 시점 호출 결과가 i 이후 데이터에 의존하지 않는다"를
데이터를 잘라 넣어 확인한다.

## 거래비용 — 빼먹지 못하게 강제

모든 체결은 `Broker`를 거친다(매수/매도 슬리피지 + 수수료/세금). 비용 구조는
시장별로 다르므로 분리한다 — 상세는 `docs/coding/execution-and-data.md` 7절:
- KR: 매도세(0.18%) 있음
- US: 매도세 없음, 환전 스프레드·SEC fee류 (이 프로젝트는 US·USD 단일)

비용 없는 백테스트 결과는 신뢰하지 않는다. 가능하면 토스 `/commissions` 실측값으로
캘리브레이션한다.

## 검증 게이트 (validation.md 5관문)

`src/validation/gates.ts`는 `Metrics`를 받아 합격/불합격 + 사유를 반환한다.
in-sample/out-of-sample 분리, 워크포워드, 비용 반영이 핵심. 시도한 전략 수를
기록해 다중검정을 보정한다(많이 시도할수록 기준을 엄격히).

## BacktestRun artifact

백테스트 1회 실행은 `artifacts/backtests/{id}.json`에 재현 가능한 메타와 함께
남긴다(`params`, `universe`, `dateRange`, `split.inSampleEnd`, `result`,
`oosResult`, `gate`, `triesIndex`). 대시보드가 이걸 읽으므로 shape을
`docs/coding/dashboards.md`의 `BacktestRun`과 정확히 맞춘다.

## 품질 기준

- 불변 패턴(상태 변이 금지), 순수 함수 우선.
- 파일 200~400줄, 관심사별 분리.
- 지표 공식·게이트·look-ahead 차단은 단위 테스트 우선(TDD).
- 비현실적으로 좋은 결과가 나오면 멈추고 look-ahead/비용을 먼저 의심한다.

## 참고 문서

- `docs/coding/interfaces.md` — 타입·Broker·백테스터 골격
- `docs/coding/architecture.md` — 레이어·데이터 흐름
- `docs/strategy/validation.md` — 5관문·함정·지표
- `docs/coding/execution-and-data.md` — 비용 모델 US/KR
