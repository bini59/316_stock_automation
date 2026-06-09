---
name: quant-strategy-impl
description: "국면 분류·전략 풀·감성리스크·메타배분 전략 레이어를 구현하는 절차. RegimeClassifier(연속 멤버십+히스테리시스), RegimeStrategy(모멘텀·평균회귀·방어·현금), 적극도 산출(규칙 베이스라인+AI 오버레이), 자본 배분(상관 중복 제거). 전략/국면/시그널/배분/모멘텀/평균회귀/적극도 구현을 시작하면 반드시 이 스킬을 사용할 것."
---

# Quant Strategy Impl — 전략 레이어 구현 절차

규칙으로 뼈대를 만들고 AI는 보조로만 가두는 하이브리드. 미국 주식, 톱다운 국면,
target-weight, 중·저빈도가 전제다. 각 레이어의 설계 원본은 `docs/strategy/`에 있고,
이 스킬은 구현 시 반드시 지킬 공통 규율을 담는다.

## 레이어별 구현 순서 (입력 계약을 먼저 합의)

1. **국면 분류**(`src/regime/`) — `docs/strategy/regime.md`
2. **전략 풀**(`src/strategies/`) — `docs/strategy/strategy-pool.md`
3. **감성·리스크 → 적극도**(`src/sentiment/`) — `docs/strategy/sentiment-risk.md`
4. **메타 배분**(`src/meta/`) — `docs/strategy/meta-allocation.md`

하위 레이어는 상위의 출력 계약(`membership` → `StrategyProposal[]` →
`MetaAllocation` → ×`aggressiveness`)에만 의존한다. 구현 전 입력 계약을 먼저 합의.

## 절대 규율 (모든 레이어 공통)

### look-ahead 차단
전략·분류기는 엔진이 잘라 넘기는 "현재까지" history만 본다. 직접 전체 시계열에
접근하지 않는다. 백분위·EMA 평활·상관 추정 등 **모든 통계는 trailing window로만**
계산한다. 미래를 보면 백테스트가 거짓이 된다.

### AI는 4번 레이어에만, 참고자료로만
방향(국면·전략)과 돈(주문)은 규칙으로 정한다. 감성 시스템은 **AI 없이도 완결**
되어야 하며(`useSentiment:false`가 1급 모드), AI 감성은 경계 밴드 안에서만 적극도를
미세조정한다(비대칭: 줄이는 건 크게, 키우는 건 작게). 없거나 낡으면 중립으로
graceful 강등. 이유: AI가 오작동해도 시스템이 통째로 무너지지 않게.

### whipsaw를 죽인다
국면 경계에서 하드 스위치 금지. 소프트 멤버십과 활성도 블렌딩(`membership ×
regimeAffinity`)으로 부드럽게. 하드 라벨이 필요하면 슈미트 트리거 + 체류시간.

### 거래비용 의식 + 과최적화 경계
잦은 리밸런싱은 비용으로 죽는다 — 무거래 밴드·중·저빈도 유지. 파라미터 수를 적게
유지하고, 평균회귀처럼 국면 의존적 전략은 반드시 국면 게이트로 활성 구간을 제한한다.

## 타입 계약 준수

`quant-engine-engineer`가 정한 `src/types/`로만 연결한다. 새 타입이 필요하면 직접
만들지 말고 engine-engineer에게 요청. 하위 레이어에는 분류기 **내부 신호가 아니라**
`RegimeState.membership`만 노출한다 — 분류기를 갈아끼워도 안 깨지게.

## 검증 연계

백테스트 실행·게이트는 engine-engineer의 프레임워크를 쓴다. 시도한 전략·파라미터
조합 수를 기록한다(다중검정). 성과가 비현실적으로 좋으면 멈추고 look-ahead·비용
누락을 먼저 의심하고 quant-validator에게 교차검증을 요청한다.

## 품질 기준

- 순수 함수 우선, 불변 패턴, 파일 200~400줄.
- 멤버십 함수·활성도·적극도 산출은 단위 테스트로 시나리오 검산(예: VIX 35 +
  하락추세 → crisis 멤버십 점화).

## 참고 문서

- `docs/strategy/regime.md` · `strategy-pool.md` · `sentiment-risk.md` · `meta-allocation.md`
- `docs/coding/interfaces.md` — Strategy/Signal 계약
- `docs/strategy/validation.md` — 함정·검증
