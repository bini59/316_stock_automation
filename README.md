# 레짐 기반 멀티 전략 자동매매 시스템

시장 국면(상승/하락/횡보/위기)을 판정하고, 국면별 전략 풀을 운용하며,
감성·리스크로 적극도를 조절하고, 메타 레이어가 자본을 배분하는 알고리즘
트레이딩 시스템. TypeScript로 구현하는 **헤드리스 엔진**(CLI-first) + 선택적
Next.js 관측·제어 대시보드.

## 절대 원칙

1. **look-ahead bias 차단** — 전략에는 "현재 시점까지"의 데이터만 전달한다. 타입 수준에서 미래 접근을 막는다.
2. **거래비용 항상 반영** — 수수료·세금·슬리피지·FX 스프레드를 모든 백테스트에 포함한다.
3. **레이어 간 결합 최소화** — 각 레이어는 `src/types/`의 타입 계약으로만 연결된다.
4. **검증을 먼저** — 전략보다 백테스트·검증 프레임워크를 먼저 신뢰 가능하게 만든다.

## 아키텍처 (6 레이어 + 관측 표면)

```
① 국면 분류   classify(history)            → RegimeState.membership
② 전략 풀     runPool(strategies, universe, regime) → StrategyProposal[]
③ 메타 배분   allocate({ proposals }, cfg) → MetaAllocation.weights
④ 적극도      computeAggressiveness(risk, cfg, sentiment?) → aggressiveness
⑤ 정산·실행   reconcile(target, account, universe) → Order[] → OrderExecutor
   대시보드    artifacts/ 를 읽어 시각화 (UI는 읽고, 엔진이 결정)
```

## 폴더 구조

```
src/
├── types/        # 공통 타입 계약 (모든 레이어의 유일한 결합점)
├── data/         # 데이터 적재·유니버스·분할
├── engine/       # 백테스터·broker 비용모델·portfolio·reconcile
├── validation/   # metrics·gates·walkForward
├── regime/       # 국면 분류
├── strategies/   # 국면별 전략 풀
├── sentiment/    # 감성·리스크 → 적극도
├── meta/         # 메타 자본 배분
├── broker/       # 브로커 어댑터 (mock / toss)
└── pipeline/     # 한 사이클 오케스트레이션 + 백테스트 러너
artifacts/        # 엔진 ↔ 대시보드의 유일한 접점
web/              # Next.js 대시보드 (/backtest, /live)
```

## 개발

```bash
npm install
npm run typecheck   # 타입 체크
npm test            # 단위 테스트 (Vitest)
npm run build       # 빌드
```

자세한 설계·규약은 `docs/`, 구현 로드맵은 `TODO.md` 참조.

## 라이선스

MIT
