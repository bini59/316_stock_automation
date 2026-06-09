# TODO — 레짐 기반 멀티 전략 자동매매 시스템 (처음부터 끝까지)

> 이 파일은 `docs/`와 `CLAUDE.md`를 기반으로 한 **전체 구현 로드맵**이다.
> 작업은 의존 역순으로(토대 → 위층) 진행한다: `types/` → 엔진 → 검증 → 데이터 →
> 전략 4레이어 → 파이프라인 → 실행/정산 → 토스 어댑터 → artifacts → 대시보드 → 모드 승급.
>
> **항상 지킬 4대 원칙** (CLAUDE.md): ① look-ahead 차단(타입+루프) ② 모든 백테스트에
> 거래비용 반영 ③ 레이어는 `types/` 계약으로만 결합 ④ 검증을 전략보다 먼저.
>
> **작업 규율**: 각 항목은 TDD(테스트 먼저) → 구현 → 커밋(pre-commit hook이 타입체크+테스트
> 자동 실행). 성과가 비현실적으로 좋으면 멈추고 look-ahead/비용 누락부터 의심한다.
>
> **담당 매핑** (`.claude/agents` + `.claude/skills`):
> - 엔진/검증/types → `quant-engine-engineer` + skill `quant-engine-build`
> - 전략 4레이어 → `quant-strategist` + skill `quant-strategy-impl`
> - 실행/정산/토스/안전장치 → `execution-engineer` + skill `toss-execution-build`
> - 대시보드 → `dashboard-engineer` + skill `trading-dashboard-build`
> - 적대적 QA(look-ahead/비용/과최적화 교차검증) → `quant-validator` (각 레이어 완료 직후)

---

## Phase 0 — 프로젝트 부트스트랩

목표: TypeScript 헤드리스 엔진이 돌 수 있는 최소 환경. UI/토스 없이도 빌드·테스트가 통과.

- [x] **0.1 패키지 초기화** — `package.json` (name, `"type": "module"`, scripts: `build`/`test`/`test:watch`/`lint`/`typecheck`)
- [x] **0.2 TypeScript 설정** — `tsconfig.json` (`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `target: ES2022`, `moduleResolution: "bundler"|"node16"`). strict 옵션은 look-ahead/계약 위반을 컴파일 타임에 잡는 1차 방어선.
- [x] **0.3 테스트 러너** — Vitest 설치·설정 (`vitest.config.ts`, coverage 임계 80% 설정). 단위 테스트가 검증 프레임워크의 핵심이므로 1순위.
- [x] **0.4 린트·포맷** — ESLint + Prettier (글로벌 hook이 prettier/tsc를 후처리하므로 충돌 없게 정렬).
- [x] **0.5 폴더 골격 생성** — `project-structure.md` 기준으로 빈 디렉토리 + `index.ts`:
      `src/{types,data,engine,validation,strategies,regime,sentiment,meta,broker,pipeline}/`, `artifacts/{backtests,live}/`
- [x] **0.6 `.gitignore`** — `node_modules`, `dist`, `artifacts/live/*`(실거래 스냅샷은 커밋 안 함), `.env*`
- [x] **0.7 비밀 관리 골격** — `.env.example` (토스 `TOSS_CLIENT_ID`/`TOSS_CLIENT_SECRET`/`TOSS_ACCOUNT_SEQ` 플레이스홀더만). 실제 키는 절대 커밋 금지.
- [x] **0.8 git 초기화** — repo init, 통합 브랜치(`main`) + 작업 브랜치 컨벤션(`feature/...`) 확인.

**완료 기준**: `npm run typecheck`, `npm test`(빈 통과), `npm run build`가 모두 성공.

---

## Phase 1 — 타입 계약 (`src/types/`) ★ 모든 레이어의 유일한 결합점

> 설계 원본: `docs/coding/interfaces.md` + 각 레이어 문서. **계약을 새로 짜지 말고 문서 타입을 그대로 구현.**
> 한 파일 한 관심사. 변경 시 영향 범위가 크므로 이 단계에서 최대한 확정.

- [x] **1.1 `types/market.ts`** — `Bar`(timestamp/OHLCV), `PriceSeries = readonly Bar[]`
- [x] **1.2 `types/strategy.ts`** — `SignalAction`, `Signal`, `Strategy`(단일종목 atom, `next(history)`), 그리고 확장: `UniverseHistory`, `StrategyProposal`, `RegimeStrategy`(`family`/`regimeAffinity`/`propose`)
- [x] **1.3 `types/result.ts`** — `Trade`(비용 차감 후 pnl), `Metrics`(totalReturn/sharpe/maxDrawdown/winRate/tradeCount), `BacktestResult`(equityCurve/trades/metrics)
- [x] **1.4 `types/regime.ts`** — `RegimeLabel`, `RegimeState`(trend/volatility/trendQuality/membership/label/confidence), `MacroContext`, `RegimeClassifier` 인터페이스
- [x] **1.5 `types/sentiment.ts`** — `SentimentSignal`, `RiskInputs`, `AggressivenessConfig`, `AggressivenessResult`, `computeAggressiveness` 시그니처
- [x] **1.6 `types/allocation.ts`** — `AllocationConfig`, `AllocationInput`, `MetaAllocation`, `allocate` 시그니처
- [x] **1.7 `types/account.ts`** — `Holding`, `AccountState`(baseCurrency `"USD"`, NAV = 현금+유니버스 보유 평가액)
- [x] **1.8 `types/order.ts`** — `Order`(symbol/side/notional/reason), `OrderResult`
- [x] **1.9 `types/broker-port.ts`** — `AccountSource`, `MarketDataSource`, `OrderExecutor`, `ExecMode`
- [x] **1.10 `types/gate.ts`** — `GateCriteria`, `GateResult`
- [x] **1.11 `types/artifact.ts`** — `BacktestRun`, `LiveSnapshot`, `ControlFlags` (대시보드와 shape 정확히 일치 — `dashboards.md` 2절)
- [x] **1.12 `types/index.ts`** — 배럴 export
- [x] **1.13 look-ahead 타입 가드 검토** — 전략/분류기가 전체 시계열에 접근할 경로가 타입상 없는지 확인(`next`/`classify`/`propose`는 "현재까지" history만 받음).

**완료 기준**: 타입만으로 컴파일 통과. 전 레이어 함수 시그니처가 문서와 1:1.
**검증**: `quant-validator`에게 "레이어 간 타입 계약 정합성 + look-ahead 차단 가능성" 교차검토 요청.

---

## Phase 2 — 엔진 토대 + 검증 프레임워크 (`src/engine/`, `src/validation/`) ★ 전략보다 먼저

> skill `quant-engine-build`. "검증을 먼저 신뢰 가능하게." 이 프레임워크가 거짓말(과최적화·
> look-ahead·비용누락)을 거르는 장치다. **지표 공식·게이트·look-ahead·비용은 TDD 필수.**

### 2.1 Broker 비용 모델 (`engine/broker.ts`)
- [x] `BrokerConfig` 시장 분리 버전 구현 — `market:"KR"|"US"`, commissionRate/taxRate/feeRate/fxSpread/slippageRate (`execution-and-data.md` 7절)
- [x] `fillBuy`/`fillSell`(슬리피지), `cost(side, notional)`(수수료+세금+fee+fx) 구현
- [x] **US 기본 프로필** 제공(매도세 0, SEC/TAF fee류, FX 스프레드), KR 프로필은 골격만
- [x] 단위 테스트: 매수/매도 비용이 항상 양수로 빠져나가는지, US/KR 분기

### 2.2 포트폴리오 추적 (`engine/portfolio.ts`)
- [x] 다중 종목 포지션·현금·평가액 추적 (불변 패턴, 상태 변이 금지)
- [x] NAV 계산(현금 + 유니버스 보유 평가액) — `account.ts` 정의와 일치
- [x] 단위 테스트: 매수/매도 후 현금·수량·평가액 정합

### 2.3 지표 계산 (`validation/metrics.ts`)
- [x] `computeMetrics(equityCurve, trades)` — totalReturn, **sharpe(연율화)**, **maxDrawdown(0..1)**, winRate, tradeCount
- [x] 단위 테스트: 알려진 입력에 대한 샤프·MDD 정답 검산(예: 단조 상승 → MDD 0)

### 2.4 합격 게이트 (`validation/gates.ts`)
- [x] `evaluateGate(metrics, criteria)` — `validation.md` 코드 그대로, 실패 사유 문자열 기록
- [x] **다중검정 보정 훅** — `triesIndex`가 클수록 기준을 엄격히 적용하는 로직(또는 호출부 정책)
- [x] 단위 테스트: minSharpe/maxDrawdown/minTradeCount 각 실패 케이스

### 2.5 백테스터 루프 (`engine/backtester.ts`)
- [x] `backtest(strategy, data, broker, initialCapital)` — `interfaces.md` 골격 기반 단일종목 버전
- [x] **매 시점 `data.slice(0, i+1)`로만 전략 노출** (look-ahead 1차 방어선)
- [x] 모든 체결이 `Broker`를 거치도록 강제(비용 누락 구조적 차단)
- [x] equityCurve·trades 산출 후 `computeMetrics` 호출
- [x] **★ look-ahead 단위 테스트**: i 시점 호출 결과가 i 이후 데이터에 의존하지 않음을 데이터 잘라 넣어 증명
- [x] **다중종목 백테스터** — `portfolio.ts`로 포지션 관리 분리, `UniverseHistory` + target-weight 입력 받는 버전(파이프라인 통합용)

### 2.6 데이터 분할 (`validation/`+`data/splitter.ts`)
- [x] `splitInOutSample(series, ratio=0.7~0.8)` — in/out-of-sample 경계(`split.inSampleEnd`) 산출
- [x] **OOS 데이터는 튜닝에 절대 노출 금지** 규약을 코드 주석·구조로 명시

### 2.7 워크포워드 분석 (`validation/walkForward.ts`)
- [x] rolling window: "N년 학습 → M개월 검증 → 창을 앞으로 굴려 반복"
- [x] 구간별 metrics 집계 + 일관성 리포트
- [x] 단위 테스트: 창 분할 경계가 미래를 안 넘는지

**완료 기준**: 더미 전략(예: 항상 HOLD, 또는 단순 buy&hold)으로 백테스트가 비용 반영된 결과를 내고, look-ahead 테스트가 통과.
**검증**: `quant-validator` — "비용이 정말 빠지는가, look-ahead 누출 없는가, 샤프/MDD 공식이 맞는가" 적대적 점검.

---

## Phase 3 — 데이터 레이어 (`src/data/`)

> 토대. 데이터 품질이 나쁘면 위층이 전부 무너진다(garbage in, garbage out).
> **API 키 없이** 외부 무료 소스(예: yfinance/CSV)로 백테스트용 과거 데이터부터 확보.

- [x] **3.1 `data/loader.ts`** — OHLCV 적재 인터페이스. 소스 추상화(CSV/외부 API). 기준 지수(`^GSPC`/`SPY`), 보조(`^VIX`/`^VIX3M`), 유니버스 종목 공급
- [x] **3.2 시점별 유니버스 공급** — `strategy-pool.md` 6절. **생존편향 차단**: 그 시점에 실제 존재·편입된 종목만. point-in-time 데이터 없으면 **섹터 ETF 유니버스**로 시작(편향 축소)
- [x] **3.3 데이터 정합 검사** — 결측·중복 타임스탬프·정렬 검증 유틸. 분할(splitter는 Phase 2.6)
- [x] **3.4 백테스트 데이터셋 캐시** — 로컬 캐시(반복 백테스트 속도). 토스 `/candles` 깊이 부족 시 외부 소스로 보강하는 분리 전략 메모(`execution-and-data.md` 6절 미정3)
- [x] **3.5 단위 테스트** — 로더가 PriceSeries를 시간순 정렬·결측 없이 반환

**완료 기준**: 수년치 SPY/VIX/유니버스 데이터를 PriceSeries로 적재, in/out 분할 가능.

---

## Phase 4 — 전략 레이어 (4개) ★ skill `quant-strategy-impl`

> 하위→상위 계약 순서로: `membership` → `StrategyProposal[]` → `MetaAllocation` → ×`aggressiveness`.
> **공통 규율**: 모든 통계는 trailing window만. whipsaw는 소프트 멤버십+활성도 블렌딩으로 죽인다.
> 멤버십·활성도·적극도 함수는 시나리오 단위 테스트로 검산.

### 4.1 국면 분류 (`src/regime/`) — `docs/strategy/regime.md`
- [x] **4.1.1 입력 신호 계산기** (`regime/signals.ts`) — 추세축(`d200`, `slope200`, Kaufman `ER`), 변동성축(`rv20`, `rvPct`, `vixPct`, `termStress`). **전부 trailing window·후행 백분위**
- [x] **4.1.2 연속 축 산출** — z표준화(±3σ 윈저라이즈), `trend = tanh(k_t·trendRaw)`, `trendQuality = ER`, `volatility = clamp(...)`
- [x] **4.1.3 소프트 멤버십** — bull/bear/chop/crisis 어피니티 → 정규화(합=1), `confidence = 1 − entropy/log4`
- [x] **4.1.4 히스테리시스 3중 방어** — ① 소프트 멤버십 ② 입력 EMA 평활(span 7) ③ 하드 라벨 슈미트 트리거(진입 0.50/이탈 0.40) + 체류 K=3일
- [x] **4.1.5 `RuleBasedRegimeClassifier`** — `classify(history, ctx?)` 구현, 기본 파라미터(regime.md 7절)
- [x] **4.1.6 단위 테스트** — 시나리오 검산(VIX 35+하락추세 → crisis 점화 / 깨끗한 상승 → bull), **look-ahead 테스트**(백분위·EMA가 미래 미참조), whipsaw(경계에서 라벨이 안 튀는지)
- [ ] **4.1.7 간접 검증** — always-on 대비 국면 조건부 스위칭이 샤프↑/MDD↓ (Phase 5 통합 후 측정), 위기 적시성(2018Q4/2020-03/2022)

### 4.2 전략 풀 (`src/strategies/`) — `docs/strategy/strategy-pool.md`
> **롱-온리 + 현금** 기본. 공매도는 v2. 주간 리밸런싱 기본.
- [x] **4.2.1 풀 라우터** (`strategies/pool.ts`) — `runPool`: `activation = Σ membership×regimeAffinity`, 활성도 태그 후 `StrategyProposal[]`
- [x] **4.2.2 추세/모멘텀 패밀리(bull)** — TS 모멘텀, XS 모멘텀(12-1개월, 최근1개월 제외), 듀얼 모멘텀. 공통: 200일선 위만 후보
- [x] **4.2.3 평균회귀 패밀리(chop)** — z-스코어 회귀, RSI(2) 회귀, 볼린저 회귀. **국면 게이트 필수**(추세장 칼받기 방지), 200일선 위 과매도만 옵션
- [x] **4.2.4 방어 패밀리(bear)** — 저변동 틸트, 방어섹터 로테이션, 현금 레이즈
- [x] **4.2.5 현금 패밀리(crisis)** — All-cash(`weights = {}`)
- [x] **4.2.6 단위 테스트** — 각 전략 `propose`가 비활성 국면에서 빈/축소 비중, look-ahead 차단, 활성도 블렌딩 부드러움
- [ ] **4.2.7 검증 포인트** — 국면 게이트 있음/없음 비교(핵심 가설), 리밸런싱 주기별 비용 후 순수익, 다중검정 카운트 기록

### 4.3 감성·리스크 → 적극도 (`src/sentiment/`) — `docs/strategy/sentiment-risk.md`
> **AI 없이 완결**되어야 함(`useSentiment:false`가 1급 모드). AI는 경계 밴드 안 미세조정만.
- [x] **4.3.1 규칙 베이스라인** (`sentiment/aggressiveness.ts`) — `A_vol = targetVol/realizedVol`, `A_crisis = 1−crisis멤버십`, `A_dd = ddBrake(dd)`, 곱 후 클램프
- [x] **4.3.2 AI 오버레이** — 비대칭 밴드(상방 +0.15 / 하방 −0.30), `s_eff = score×confidence`
- [x] **4.3.3 그레이스풀 디그레이데이션** — useSentiment=false / undefined / 신선도 초과 / confidence<minConfidence / 예외 → `s_eff=0`(베이스라인만)
- [x] **4.3.4 `computeAggressiveness` 순수 함수** — sentiment 없어도 `base` 반환
- [x] **4.3.5 (보조 모듈) 감성 파이프라인** — LLM으로 뉴스/공시 텍스트 → `SentimentSignal`(시장 전체 1개, `asOf` 신선도 스탬프 필수). 본 레이어 바깥, 실패해도 중립 흡수. **가격예측 딥러닝 금지**
- [x] **4.3.6 단위 테스트** — vol-target 감쇠, crisis→0 수렴, dd 브레이크 선형, AI off==base, 낡은 감성 무시, **look-ahead**(asOf가 의사결정 시점 이전)
- [ ] **4.3.7 검증** — A/B(on vs off): off가 견고한가 + on이 샤프·MDD를 유의하게 개선하나, 노이즈 주입 강건성, 비대칭(하방만) 검증

### 4.4 메타 배분 (`src/meta/`) — `docs/strategy/meta-allocation.md`
> **상대 비중만**(Σ≤1). 핵심은 상관 중복 베팅 제거.
- [x] **4.4.1 v1 활성도+패밀리 예산** (`meta/allocate.ts`) — 후보필터(minActivation) → base=activation → 패밀리 예산 상한(maxWeightPerFamily) 내 비례축소 → normalize
- [x] **4.4.2 종목 비중 합성 + 포지션 가드** — `w[sym]=Σ strategyAlloc×proposal.weights`, maxWeightPerSymbol 상한, 재정규화(Σ≤1, 차액은 암묵 현금)
- [x] **4.4.3 `allocate` 순수 함수** — strategyReturns 없으면 v1로 폴백
- [x] **4.4.4 v2 상관 기반 다양화(교체 가능)** — 리스크패리티/HRP/상관페널티. **상관은 trailing 수익률로만, 성과추종 금지(강한 shrinkage 없이는)**
- [x] **4.4.5 단위 테스트** — 패밀리 예산 상한, 종목 집중 상한, 같은 종목 합산 병합, **look-ahead**(상관이 미래 미참조)
- [ ] **4.4.6 검증** — 메타 vs naive Σ: 유효 베팅 수(1/Σwᵢ²)↑·집중도↓·MDD↓, v1 vs v2, 턴오버(Σ|Δw|)

**검증 게이트(전략 레이어 전체)**: `quant-validator` — look-ahead 누출, 거래비용 후 생존, 다중검정 보정, 레이어 간 계약 정합. **성과가 너무 좋으면 반드시 호출.**

---

## Phase 5 — 파이프라인 통합 (`src/pipeline/`) ★ 계약 체인 닫기

> `meta-allocation.md` 7절 체인을 한 사이클 함수로 엮는다. 헤드리스 CLI-first.

- [x] **5.1 한 사이클 오케스트레이터** (`pipeline/cycle.ts`):
      `classify(history,ctx)` → `runPool(strategies,universe,regime)` → `allocate({proposals},cfg)` → `computeAggressiveness(risk,cfg,sentiment?)` → `finalGross[sym] = weights[sym]×aggressiveness`
- [x] **5.2 백테스트 러너** (`pipeline/runBacktest.ts`) — 다중종목 백테스터(2.5) + 파이프라인을 시점마다 호출, 주간 리밸런싱 주기에만 체결, 비용 반영
- [x] **5.3 in/out-of-sample + 워크포워드 통합 실행** — 튜닝은 in-sample, OOS는 시험만
- [x] **5.4 BacktestRun artifact 산출** (`pipeline/writeArtifact.ts`) — `artifacts/backtests/{id}.json`에 params/universe/dateRange/split/result/oosResult/gate/triesIndex 기록. shape은 `dashboards.md` `BacktestRun`과 정확히 일치
- [x] **5.5 CLI 엔트리** (`src/index.ts`) — `run-backtest` 명령(전략·기간·유니버스 인자)
- [x] **5.6 E2E(엔진)** — 더미~실제 전략으로 전체 체인이 비용 반영된 BacktestRun을 떨구는지
- [x] **5.7 핵심 가설 측정** — 국면 조건부 멀티전략이 always-on/buy&hold 대비 샤프↑·MDD↓ (4.1.7 회수)

**완료 기준**: `npm run` 한 줄로 백테스트 → `artifacts/backtests/`에 JSON. API 키 0개.
**검증**: `quant-validator` 전체 파이프라인 적대적 검증(look-ahead/비용/과최적화/in-out 누수).

---

## Phase 6 — 실행/정산 레이어 (mock 우선) ★ skill `toss-execution-build`

> 전략 스택은 토스를 **모른다**. 추상 포트 + mock으로 전체 파이프라인을 키 없이 완성.
> **백테스트와 실거래가 동일한 `reconcile` 로직을 공유**한다. 안전장치가 1급 시민.

- [x] **6.1 mock 어댑터** (`src/broker/mock/`) — `SimulatedAccount`, `SimulatedMarketData`, `SimulatedExecutor`. **look-ahead 유지**(현재 시점까지만 노출)
- [x] **6.2 정산** (`engine/reconcile.ts`) — `reconcile(target, account, universe, cfg)`: **유니버스 안만**, 금액 기반(`notional`), **무거래 밴드**(`minTradeNotional` 이하 무시), exit/rebalance reason
- [x] **6.3 정산 단위 테스트** — 유니버스 밖 보유 불간섭, 목표−현재 델타, 밴드 churn 방지, 안 가진 종목도 목표면 매수
- [x] **6.4 실행 모드** (`ExecMode`) — BACKTEST/DRY_RUN/LIVE_SMALL/LIVE. **DRY_RUN=계산·로깅만, 미제출**(페이퍼 대체)
- [x] **6.5 안전장치(코드 강제)** — 킬스위치(→DRY_RUN 강등+미체결 취소), 주문 한도(1회/일일 금액·건수 캡), 고액주문 플래그(>1천만원 confirmHighValueOrder), **멱등성**(클라이언트 식별자+미체결 조회 대조로 중복주문 차단), 사전 sanity(가격 이탈/매도≤보유/매수≤buying-power), 장중/휴장 가드, **fail-safe**(플래그 읽기 실패→DRY_RUN)
- [x] **6.6 ControlFlags 폴링** — 엔진이 매 사이클 `artifacts/live/control.json` 폴링해서 따름. 손상 시 보수적 DRY_RUN
- [x] **6.7 LiveSnapshot 산출** — 매 사이클 `artifacts/live/`에 떨굼(account/regime/aggressiveness/targetWeights/openOrders/recentDecisions/pnl)
- [x] **6.8 안전장치 단위 테스트** — 킬스위치, 멱등성(중복 제출 안 됨), sanity 거부, 모드 승급 가드
- [ ] **6.9 보안 리뷰** — `security-reviewer`: OAuth 비밀·주문 경로

**완료 기준**: mock으로 BACKTEST/DRY_RUN 전 파이프라인이 주문 계획까지 돈다. LiveSnapshot/ControlFlags 산출.

---

## Phase 7 — 토스증권 실어댑터 (★ API 키 확보 후)

> 같은 추상 포트의 구현체 하나. 키 없으면 Phase 6에서 멈추고 여기로 진입하지 않는다.

- [ ] **7.1 OAuth2** — `POST /oauth2/token`(Client Credentials), 토큰 캐시·갱신. client_id/secret은 **환경변수**(하드코딩 금지)
- [ ] **7.2 `TossAccountSource`** — `GET /holdings`+`/buying-power`+`/accounts`, `X-Tossinvest-Account` 헤더 → `AccountState`
- [ ] **7.3 `TossMarketData`** — `GET /candles`(+히스토리 깊이 실측), `GET /prices`. REST only → 폴링
- [ ] **7.4 `TossOrderExecutor`** — `POST /orders`(+`/modify`,`/cancel`), amount 기반, `/sellable-quantity` 매도 가드
- [ ] **7.5 레이트리밋·재시도** — 인증5/시세10/주문6(09:00–09:10 3)/계좌1–5 per s, 429 `Retry-After`+지수 백오프
- [ ] **7.6 비용 캘리브레이션** — `GET /commissions` 실측값으로 `BrokerConfig`(US) 채움. 추측 금지
- [ ] **7.7 미정 사항 해소** — 캔들 깊이가 백테스트(수년)에 충분한가? 부족 시 외부 소스로 백테스트 보강, 토스는 실거래 시세·체결 전용 분리
- [ ] **7.8 통합 테스트(DRY_RUN)** — 실계좌·실시세 읽되 주문 미제출, 정산 로직·포맷·레이트리밋 무위험 검증

---

## Phase 8 — 대시보드 (`web/`, Next.js) ★ skill `trading-dashboard-build`

> **UI는 읽고, 엔진이 결정한다.** 매매 로직 0. 유일한 쓰기는 운영 제어(ControlFlags).
> 엔진↔웹 접점은 `artifacts/` 하나. `types/`를 타입으로만 import(재구현 금지).

- [x] **8.1 Next.js 앱 스캐폴드** — `web/`, `/backtest`·`/live` 라우트, API routes가 `artifacts/` 읽기·제어 쓰기. 차트는 lightweight-charts(TradingView)
- [x] **8.2 `/backtest` 페이지** (API 키 불필요, 지금 바로):
      - [x] 성과 패널(equity curve, 샤프·MDD·승률·거래수, 거래 마커)
      - [x] **in/out-of-sample 시각 분리** — OOS 보며 튜닝 못 하게(validation.md 2번)
      - [x] **다중검정 카운터**(`triesIndex` 크게) — "100개 중 5개는 운"
      - [x] 게이트 배지(GateResult 합격/사유)
      - [x] 국면 타임라인(membership 띠를 성과 위에 겹침)
      - [x] 런 비교(여러 BacktestRun 파라미터 diff + 성과 diff)
- [x] **8.3 `/live` 페이지** (먼저 mock LiveSnapshot 골격):
      - [x] 포트폴리오(보유·비중·평가손익·NAV·현금, 목표 vs 현재)
      - [x] 국면·적극도(membership·label·적극도 스칼라·브레이크 상태)
      - [x] 주문(미체결·최근 체결·의사결정 로그), 모드 배지(크게)
      - [x] **제어(유일한 쓰기)**: 킬스위치, 일시정지, 모드 전환 요청(requestedMode)
- [x] **8.4 제어 채널 안전** — 엔진이 폴링해 따름(웹이 엔진 직접 호출 안 함), 킬스위치 fail-safe, 종목·비중·주문 지정 경로 없음
- [ ] **8.5 실데이터 배선** — 토스 키 확보 후 mock → 실 LiveSnapshot 교체
- [x] **8.6 E2E(Playwright)** — `/backtest` 렌더, 킬스위치 토글이 ControlFlags를 뒤집는지

---

## Phase 9 — 검증 관문 승급 (모드 단계 승급)

> `execution-and-data.md` 9절. 각 단계에서 **백테스트 성과 ≈ 실거래 성과**(일치도) 확인 후만 승급.

- [ ] **9.1 BACKTEST 게이트** — 비용 반영, in/out-of-sample 분리, 워크포워드 일관성, 게이트 통과
- [ ] **9.2 DRY_RUN** — 실데이터로 파이프라인 무위험 검증(정산·포맷·레이트리밋), 며칠~몇 주 관찰
- [ ] **9.3 LIVE_SMALL** — 소액 한도 실제 제출, **라이브-백테스트 일치도 측정**. 불일치 크면 비용모델·슬리피지·체결 가정 재점검
- [ ] **9.4 LIVE** — 점진 증액. 킬스위치·한도 상시 가동
- [ ] **9.5 운영 런북** — 킬스위치 절차, 장애 대응(fail-safe DRY_RUN), 비밀 회전 절차

---

## 횡단 관심사 (전 단계 상시)

- [ ] **테스트 커버리지 80%+** — unit(지표/게이트/멤버십/정산/멱등성) + integration + E2E
- [ ] **look-ahead 회귀 테스트** — 신규 통계 추가 시마다 "i 이후 데이터 미참조" 테스트 동반
- [ ] **거래비용 항상 on** — 비용 0 백테스트 결과는 신뢰·기록하지 않음
- [ ] **다중검정 로그** — 시도한 전략·파라미터 조합 수 누적 기록, 시도↑ → 게이트↑
- [ ] **불변 패턴·순수 함수·파일 200~400줄** (coding-style)
- [ ] **비밀 관리** — 키는 환경변수, `.env`는 gitignore, 노출 시 즉시 회전
- [ ] **레이어 결합 검사** — 레이어가 다른 레이어 구현을 직접 import하지 않고 `types/`로만 연결되는지 주기 점검
- [ ] **머지 전 리뷰 게이트** — 통합 브랜치 머지 전 `code-reviewer`, CRITICAL/HIGH 필수 수정

---

## 마일스톤 요약

| # | 마일스톤 | 산출물 | API 키 |
|---|----------|--------|--------|
| M1 | 부트스트랩 + 타입 계약 | 컴파일되는 `types/` | 불필요 |
| M2 | 엔진+검증 토대 | 비용 반영·look-ahead 차단 백테스터 | 불필요 |
| M3 | 데이터 레이어 | 수년치 PriceSeries + 유니버스 | 불필요 |
| M4 | 전략 4레이어 | regime/pool/sentiment/meta | 불필요 |
| M5 | 파이프라인 통합 | `artifacts/backtests/*.json` | 불필요 |
| M6 | 실행/정산(mock) | DRY_RUN까지 도는 주문 계획 | 불필요 |
| M7 | 백테스트 대시보드 | `/backtest` | 불필요 |
| M8 | 토스 실어댑터 | 실계좌 DRY_RUN | **필요** |
| M9 | 실거래 대시보드 + 모드 승급 | `/live`, LIVE_SMALL→LIVE | **필요** |

> **API 키 없이 M7까지 전부 완성 가능.** 토스 키는 M8부터.
</content>
</invoke>
