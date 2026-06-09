---
name: trading-dashboard-build
description: "Next.js 백테스트·실거래 모니터링 대시보드를 구현하는 절차. artifacts(BacktestRun/LiveSnapshot/ControlFlags)를 읽어 equity curve·지표·국면 타임라인·다중검정 카운터·킬스위치를 렌더, lightweight-charts 사용, UI는 읽기만/제어만. 대시보드/웹페이지/차트/모니터링/시각화 UI 작업을 시작하면 반드시 이 스킬을 사용할 것."
---

# Trading Dashboard Build — 관측·제어 표면 구축 절차

백테스트 확인·보정 페이지(`/backtest`)와 실거래 모니터링 페이지(`/live`)를 만든다.
설계 원본은 `docs/coding/dashboards.md`. 이 둘은 트레이딩 척추 **바깥**에 붙는
관측 표면이라는 점이 모든 결정을 좌우한다.

## 절대 원칙 — UI는 읽고, 엔진이 결정한다

매매·신호·주문 로직을 브라우저에서 계산하지 않는다. 대시보드는 엔진이 떨군
산출물(`artifacts/`)의 뷰일 뿐이다. 이 경계를 어기면 UI가 죽거나 변조됐을 때
매매 안전성이 깨진다. 유일한 쓰기 동작은 **운영 제어**(킬스위치/일시정지/모드
전환)이며, 이는 `ControlFlags`를 쓸 뿐 엔진이 폴링해 따른다. "주문 넣기" 버튼은 없다.

## 구조

Next.js 단일 앱(`web/`), 두 라우트 `/backtest`·`/live`. 엔진과의 접점은
`artifacts/` 하나. API routes가 산출물을 읽어 페이지에 전달하고 제어 플래그를 쓴다.
엔진의 `types/`를 import해 **타입 안전하게 읽는다**(재구현 금지). 차트는
lightweight-charts(TradingView).

## /backtest — 보정 규율을 화면에 심는다

보정(calibration)은 과최적화가 일어나는 곳이다. 그래서 validation.md 규율을 UI로 강제:
- equity curve, 지표(샤프·MDD·승률·거래수), 거래 마커, 게이트 합격/불합격 배지.
- **in/out-of-sample 구간 분리 표시** — OOS를 보며 파라미터를 고치는 행위를 막는다
  (보는 순간 in-sample이 된다).
- **다중검정 카운터** — 이 전략에 대해 시도한 조합 수(`triesIndex`)를 크게 노출.
  "100개 돌리면 5개는 운으로 좋다"를 자각하게 한다.
- 국면 타임라인(membership 띠), 여러 `BacktestRun` 비교.

> 이 페이지는 **API 키 없이 지금 바로** 만든다. 엔진이 `artifacts/backtests/`에
> JSON만 떨구면 된다.

## /live — 모니터링 + 제어

`LiveSnapshot`을 읽어 포트폴리오·국면·적극도·미체결주문·로그를 보여주고,
모드 배지(DRY_RUN/LIVE_SMALL/LIVE)를 크게 표시(오인 방지). 제어는 `ControlFlags`만:
- **킬스위치** — 가장 단순·확실하게. 누르면 엔진이 다음 폴링에서 DRY_RUN 강등.
- 일시정지·모드 전환 요청.

> API 키 전엔 **mock `LiveSnapshot`으로 골격**만. 실데이터 배선은 키 확보 후.

## 경계면 정합성 (런타임 버그 1순위)

읽으려는 artifact의 정확한 shape을 생산자(engine/execution)와 **반드시 교차 확인**한다.
흔한 함정: 래핑된 응답(`{ items: [...] }`)을 배열로 기대, snake/camelCase 불일치,
옵셔널 필드 null 처리. 타입 캐스팅으로 우회하면 빌드는 통과해도 런타임에 깨진다.

## 품질 기준

- 빈 상태(artifact 누락) graceful 처리. 컴포넌트 테스트.
- 차트·테이블·지표 카드 컴포넌트 재사용. 파일 작게 유지.

## 참고 문서

- `docs/coding/dashboards.md` — artifact 계약·페이지 구성·제어 채널
- `docs/coding/execution-and-data.md` — 실행 모드·킬스위치
- `docs/strategy/validation.md` — 보정 규율 근거
