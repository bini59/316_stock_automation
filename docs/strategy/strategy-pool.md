# 국면별 전략 풀 (Strategy Pool)

> 국면 분류가 "지금 어떤 시장인가"를 말해주면, 전략 풀은 "그럼 무엇을 살까"를
> 답한다. 한 국면에 여러 전략, 한 전략에 여러 알고리즘을 둬서 분산 효과를 얻는다.

## 0. 범위 확정

- **대상 시장**: 미국 주식 (US equities), 톱다운 국면 공유(regime.md A안).
- **방향성**: **롱-온리 + 현금**을 기본으로 한다. 공매도는 개인에게 차입비용·
  무한손실·규제 리스크가 커서 v2로 미룬다. 하락·위기 국면의 "방어"는 공매도가
  아니라 **현금 비중 확대 + 저변동/방어 섹터 틸트**로 구현한다.
- **거래 빈도**: 중·저빈도. 주간 리밸런싱 기본(스윙~월 단위). 일간 신호는
  산출하되 체결은 리밸런싱 주기에만(거래비용 통제, overview.md 방향성).

## 1. 레이어 경계 — 누가 무엇을 결정하나

전략 풀이 메타·감성 레이어와 일을 겹치지 않게 못 박는다.

| 레이어 | 결정하는 것 | 결정하지 않는 것 |
|--------|-------------|------------------|
| **국면(3)** → 입력 | `membership` (bull/bear/chop/crisis 소속도) | 종목·비중 |
| **전략 풀(여기)** | 각 전략이 **유니버스 내** 종목 후보와 전략-내부 상대비중 | 전략 **간** 자본 배분, 전체 노출 크기 |
| **감성·리스크(4)** | 전체 노출(gross) 스케일 = 적극도 | 방향·종목 |
| **메타(5)** | 전략 **간** 자본 배분, 상관관계 중복 제거, 최종 종목별 비중 | — |

**한 줄 요약**: 전략 풀은 "각 전략이 무엇을 얼마나 사고 싶은지"를 **제안**만
한다. 제안들을 합쳐 최종 비중을 정하는 건 메타(5), 전체 크기를 줄이고 키우는
건 감성(4). 전략 풀은 방향과 종목 선택에만 집중.

## 2. 국면 → 전략 매핑

| 국면 | 전략 패밀리 | 핵심 발상 |
|------|-------------|-----------|
| **bull** | 추세추종 · 모멘텀 | 오르는 것이 더 오른다. 추세에 올라탄다 |
| **chop** | 평균회귀 · 레인지 | 과매도 매수·과매수 매도. 박스권 진동 수익 |
| **bear** | 방어 · 저변동 틸트 | 노출 축소, 저변동/퀄리티/방어섹터로 회피 |
| **crisis** | 현금 · 자본보존 | 거의 전량 현금. 안 죽는 게 이기는 것 |

전략은 자신이 어느 국면에서 활성인지를 `regimeAffinity`로 선언한다. 한 전략이
여러 국면에 걸칠 수 있다(예: 모멘텀은 bull 1.0, chop 0.3).

## 3. 활성도 블렌딩 — 하드 스위치 없음

국면이 바뀔 때 전략을 통째로 끄고 켜면 거래비용이 폭발한다. 대신 각 전략의
**활성도(activation)**를 `membership`과 `regimeAffinity`의 가중합으로 부드럽게 구한다.

```
activation(strategy) = Σ_label  membership[label] × regimeAffinity[label]
```

예: `membership = { bull: 0.7, chop: 0.3 }`, 모멘텀 전략 `affinity = { bull: 1.0, chop: 0.3 }`
→ `activation = 0.7×1.0 + 0.3×0.3 = 0.79`.

전략 풀은 각 전략의 제안에 이 활성도를 태그해서 메타로 넘긴다. 국면이
70→60으로 미끄러지면 활성도도 부드럽게 따라가 whipsaw가 없다.

## 4. 계약 (인터페이스)

기존 단일종목 `Strategy`(interfaces.md)는 **원자(atom)** 로 남기고, 전략 풀은
유니버스 단위로 동작하는 한 단계 위 계약을 둔다.

```typescript
// types/strategy.ts (확장)
import { PriceSeries } from "./market";
import { RegimeLabel, RegimeState } from "./regime";

/** 유니버스: 심볼 → "현재 시점까지" 바 배열 (look-ahead 차단) */
export type UniverseHistory = Readonly<Record<string, PriceSeries>>;

/** 전략 한 개의 제안: 종목별 전략-내부 상대비중 (합 ≤ 1, 나머지는 전략-내 현금) */
export interface StrategyProposal {
  readonly strategy: string;
  readonly activation: number;                 // 0..1, 국면 기반 활성도
  readonly weights: Readonly<Record<string, number>>;  // 심볼 → 0..1
}

export interface RegimeStrategy {
  readonly name: string;
  readonly family: "trend" | "meanrev" | "defensive" | "cash";
  readonly regimeAffinity: Readonly<Partial<Record<RegimeLabel, number>>>;
  readonly params: Readonly<Record<string, number>>;

  /** 유니버스 전체의 현재까지 데이터 + 국면 상태 → 전략-내부 목표비중 */
  propose(universe: UniverseHistory, regime: RegimeState): Record<string, number>;
}
```

전략 풀 자체는 등록된 전략들을 돌려 `StrategyProposal[]`을 만들고 활성도를
태그하는 얇은 라우터다.

```typescript
// strategies/pool.ts (골격)
export function runPool(
  strategies: readonly RegimeStrategy[],
  universe: UniverseHistory,
  regime: RegimeState
): StrategyProposal[] {
  return strategies.map((s) => {
    const activation = sumProduct(regime.membership, s.regimeAffinity);
    const weights = activation < EPS ? {} : s.propose(universe, regime);
    return { strategy: s.name, activation, weights };
  }).filter((p) => p.activation >= EPS);
}
```

## 5. 전략 패밀리별 구체 설계 (미국 주식)

각 패밀리에 **여러 알고리즘**을 둔다(분산·검증 다양성). 아래는 초기 후보.

### 5.1 추세/모멘텀 패밀리 — bull

| 알고리즘 | 규칙 | 비고 |
|----------|------|------|
| **TS 모멘텀** | 종목 12개월 수익률 > 0(또는 > T-bill)이면 보유 | 시계열, 단일종목 on/off |
| **XS 모멘텀** | 유니버스를 12-1개월 수익률로 랭크, 상위 분위 롱 | 횡단면. **최근 1개월 제외**(단기 반전 회피) |
| **듀얼 모멘텀** | XS 랭크 + "절대 모멘텀(>0)" 동시 충족만 보유 | 약세 진입 자동 회피 |

공통 필터: **200일선 위 종목만** 후보. 동일가중 또는 역변동성 가중.
리밸런싱 주기에만 랭크 재계산.

> `affinity: { bull: 1.0, chop: 0.2 }` 정도. 추세장에서 강하고 톱질장에선 약함.

### 5.2 평균회귀 패밀리 — chop

| 알고리즘 | 규칙 | 비고 |
|----------|------|------|
| **z-스코어 회귀** | `z = (close − SMA20)/σ20`. `z < −1` 매수, `z ≥ 0` 청산 | 단기 과매도 반등 |
| **RSI(2) 회귀** | RSI(2) < 10 매수, > 70 또는 SMA5 회귀 시 청산 | Connors 스타일 단기 |
| **볼린저 회귀** | 하단 밴드 터치 매수, 중심선 청산 | 밴드폭으로 변동성 적응 |

**필수 안전장치**: 평균회귀는 추세장에서 칼받기가 된다. 그래서 국면 게이트
(`affinity: { chop: 1.0 }`, bull/bear ≈ 0)로 톱질장에서만 활성. 추가로
"200일선 **위**에서의 과매도"만 매수(추세 역행 금지) 옵션.

### 5.3 방어 패밀리 — bear

| 알고리즘 | 규칙 | 비고 |
|----------|------|------|
| **저변동 틸트** | 유니버스에서 실현변동성 하위 분위로 비중 이동 | quality/low-vol 팩터 |
| **방어섹터 로테이션** | 필수소비재·유틸·헬스케어 비중 확대 | 방어섹터 ETF/대형주 |
| **현금 레이즈** | 전략-내부 weights 합을 낮춰 현금 비중 확대 | gross 자체 축소 |

롱-온리이므로 "방어 = 공매도"가 아니라 **덜 위험한 곳으로 + 현금↑**.

> `affinity: { bear: 1.0, crisis: 0.4, chop: 0.2 }`.

### 5.4 현금 패밀리 — crisis

| 알고리즘 | 규칙 |
|----------|------|
| **All-cash** | `weights = {}` (전량 현금). 자본보존 최우선 |
| **(옵션) 안전자산** | 소액을 단기국채 프록시(BIL/SHV)로 — 일단 v2 |

> `affinity: { crisis: 1.0 }`. crisis 멤버십이 점화되면 다른 전략 활성도를
> 압도해 자연스럽게 현금화된다(활성도 블렌딩의 덕).

## 6. 유니버스 정의

- **기본**: 유동성 좋은 미국 대형주 (예: S&P 500 구성종목) 또는 섹터/자산 ETF.
- **생존편향 차단**(validation.md 2번 함정): 백테스트 시 "지금 살아남은
  종목"이 아니라 **그 시점에 실제 존재·편입돼 있던 종목**을 써야 한다.
  상장폐지·편출 종목 포함된 시점별 구성 데이터(point-in-time)가 필요.
  데이터가 없으면 섹터 ETF 유니버스로 시작해 편향을 줄인다.
- 유니버스 구성은 `data/` 레이어가 시점별로 공급하고, 전략은 받은 것만 본다.

## 7. 검증 포인트 (validation.md 연계)

- **국면 게이트 효과**: 각 전략을 국면 게이트 있음/없음으로 비교. 평균회귀가
  chop 게이트로 추세장 손실을 실제로 피하는지 확인(이게 핵심 가설).
- **거래비용 민감도**: 리밸런싱 주기(주간/월간)별 순수익. 비용 차감 후에도
  살아남는 빈도를 고른다(overview.md 중·저빈도 원칙).
- **다중검정 보정**(validation.md 3번): 알고리즘을 여러 개 만들면 그중 몇은
  운으로 좋아 보인다. 시도한 알고리즘 개수를 기록하고 더 엄격한 기준 적용.
- **전략 간 상관**: 같은 국면 내 전략들이 사실상 같은 베팅이면 분산 효과가
  없다 → 이건 메타 레이어(meta-allocation.md)가 상관관계로 거른다.

## 8. 다음 레이어로의 계약

- **메타 레이어(5)** 는 전략 풀에서 **`StrategyProposal[]`**(전략명·활성도·
  종목별 전략-내부 비중)을 받는다. 이걸 활성도와 전략 간 상관관계로 합쳐
  **최종 종목별 비중**을 만든다.
- **감성·리스크(4)** 는 그 위에서 전체 gross 노출을 스케일한다(적극도).
- 전략 풀은 `RegimeState.membership`에만 의존하고 분류기 내부 신호엔 의존하지
  않는다 — 분류기를 갈아끼워도 안 깨지게.

## 9. v2 이후

- 공매도/롱-숏(차입비용·리스크 모델 선행 필요).
- 팩터 전략 확장(밸류·퀄리티·사이즈), 페어트레이딩(chop).
- 전략-내부 포지션 사이징을 변동성 타겟팅으로 정교화.
