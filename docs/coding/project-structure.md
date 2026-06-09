# 프로젝트 구조

관심사별로 폴더를 나눈다. 핵심은 `types/`가 모든 모듈의 공통 계약이고,
나머지 모듈은 서로 직접 의존하지 않고 타입을 통해서만 연결된다는 점.

```
src/
├── types/              # 공통 타입 정의 (모든 모듈이 의존)
│   ├── market.ts       # Bar, PriceSeries 등 데이터 타입
│   ├── strategy.ts     # Strategy 인터페이스, Signal
│   └── result.ts       # BacktestResult, Metrics
├── data/               # 데이터 레이어
│   ├── loader.ts       # 데이터 적재
│   └── splitter.ts     # in-sample/out-of-sample 분할
├── engine/             # 백테스트 엔진 (핵심)
│   ├── backtester.ts   # 시뮬레이션 루프
│   ├── broker.ts       # 체결·수수료·슬리피지 모델
│   └── portfolio.ts    # 포지션·자본 추적
├── validation/         # 검증 관문들
│   ├── walkForward.ts  # 워크포워드 분석
│   ├── metrics.ts      # 샤프·MDD 등 지표 계산
│   └── gates.ts        # 합격 기준 판정
├── strategies/         # 전략 구현체들
│   └── movingAverage.ts
└── index.ts
```

## 분류 기준

- `types/` — 모든 모듈의 계약. 다른 무엇에도 의존하지 않는다.
- `data/`, `engine/`, `validation/`, `strategies/` — 모두 `types/`에만 의존.
  서로 직접 import 하지 않는다(엔진이 metrics를 부르는 등 명시된 경우 제외).

## 의존 방향

```
strategies ─┐
data ───────┼─→ types  (모두 types 방향으로만 의존)
engine ─────┤
validation ─┘
```

엔진은 `validation/metrics`를 호출해 결과 지표를 계산하지만, 전략·데이터의
구현에는 의존하지 않는다. 전략을 추가하거나 데이터 소스를 바꿔도 엔진 코드는
그대로여야 한다.
