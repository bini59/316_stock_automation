# 메타 레이어 · 자본 배분 (Meta Allocation)

> 여러 전략이 동시에 신호를 낼 때 자본을 어떻게 나눌지 결정한다. 핵심은
> **상관관계로 중복 베팅을 걸러내는 것**. 이게 없으면 분산투자처럼 보이지만
> 실은 같은 베팅을 여러 번 하는 함정에 빠진다.

## 0. 이 레이어가 푸는 문제

전략 풀이 `StrategyProposal[]`(전략별 활성도 + 종목 비중)을 던지면, 메타가
이를 **하나의 최종 종목별 비중 벡터**로 합친다. 두 개의 하위 문제:

1. **전략 간 자본 배분** — 어느 전략에 얼마를 줄까.
2. **중복 베팅 제거** — 사실상 같은 베팅인 전략들이 자본을 이중으로 먹지 않게.

> 함정 예시: 모멘텀 전략 3개가 전부 같은 대형 추세주(AAPL·NVDA…)를 롱.
> "3개 전략 = 분산"처럼 보이지만 실제론 **1개의 베팅**. 시장이 꺾이면
> 셋이 동시에 무너진다. 메타 레이어의 존재 이유가 바로 이걸 막는 것.

## 1. 레이어 경계 (다시 확인)

| 레이어 | 비중에 대한 역할 |
|--------|------------------|
| 전략 풀(3) | 전략-내부 종목 상대비중 **제안** |
| 감성·리스크(4) | 포트폴리오 전체 gross **스칼라**(적극도) |
| **메타(5, 여기)** | 전략 **간** 배분 + 중복 제거 → **최종 종목 상대비중** |

메타는 **상대 비중**만 만든다(Σ ≤ 1). 전체 크기는 4번 적극도가 곱한다.
메타는 방향·종목 후보를 만들지 않는다 — 전략 풀이 준 것만 조합한다.

## 2. 파이프라인

```
1. 후보 필터       activation ≥ minActivation 인 전략만
2. 전략 간 배분     strategyAlloc[s]  (활성도 + 다양화 보정), Σ = 1
3. 종목 비중 합성   w[sym] = Σ_s strategyAlloc[s] × proposal[s].weights[sym]
4. 포지션 가드      종목 집중 상한, 재정규화 (Σ ≤ 1)
5. 반환             { weights, strategyAlloc, reasons }
```

3단계의 합성이 **중복을 자연스럽게 병합**한다. 두 전략이 같은 AAPL을 원하면
AAPL 비중이 합산돼 하나로 모인다(이중 카운트가 아니라 강한 확신으로 해석).
과도한 집중은 4단계 상한이 자른다.

## 3. 전략 간 배분 — 2단계 성숙도

프로젝트 철학(단순·견고 먼저, 정교함은 교체 가능한 업그레이드)을 따른다.

### v1 — 활성도 + 패밀리 예산 (기본, 견고)

상관관계 추정 없이 동작하는 강건한 휴리스틱. **"같은 패밀리 ≈ 상관 높음"**을
싼 프록시로 쓴다.

```
base[s]   = activation[s]                       # regime 기반 확신
# 패밀리 예산: 같은 family 합이 maxWeightPerFamily를 넘으면 그 안에서 비례 축소
familySum = Σ_{s∈family} base[s]
if familySum > maxWeightPerFamily:
    base[s] *= maxWeightPerFamily / familySum   # 패밀리 내부 비례 유지
strategyAlloc = normalize(base)                 # Σ = 1
```

모멘텀 전략 5개가 활성이어도 trend 패밀리 전체가 예산 상한(예: 0.5)을
넘지 못해, 한 종류의 베팅이 책을 독식하는 걸 막는다. 추정 불필요 → look-ahead·
과최적화 위험 없음.

### v2 — 상관 기반 다양화 (교체 가능)

전략 **수익률 시계열**(trailing window)로 상관행렬을 추정해 진짜 다양화를 한다.
같은 인터페이스로 끼워 v1과 A/B.

- **리스크 패리티**: 각 전략의 위험 기여를 균등화(`alloc ∝ 1/σ`의 상관보정판).
- **HRP(Hierarchical Risk Parity)**: 상관으로 전략을 군집화해 군집 간/내 배분.
  공분산 역행렬이 불안정한 소표본에서 리스크 패리티보다 견고.
- **상관 페널티**: `alloc[s] *= (1 − 평균상관[s])` 류의 단순 감쇠.

> **look-ahead 차단**: 상관은 반드시 의사결정 시점 **이전** 수익률로만 추정.
> 엔진이 과거 실현 수익률을 rolling으로 공급한다. 미래 구간 절대 금지.
> **성과 추종 금지**: 최근 잘한 전략에 자본을 몰아주는 건 과최적화·추세 추종의
> 함정. 배분은 *확신(activation) + 다양화*로 정하고, 성과 가중은 강한 수축
> (shrinkage) 없이는 넣지 않는다.

## 4. 종목 비중 합성 & 포지션 가드

```
w[sym] = Σ_s strategyAlloc[s] × proposal[s].weights[sym]      # 합성

# 종목 집중 상한: 한 종목이 책을 지배하지 못하게
for sym: w[sym] = min(w[sym], maxWeightPerSymbol)
재정규화: Σ w ≤ 1  (초과분은 비례 축소 또는 현금으로)
```

`Σ w < 1`이면 차액은 암묵적 현금. 전 전략이 방어/현금이면 `w`가 거의 비어
자연스럽게 현금 포지션이 된다.

## 5. 인터페이스

```typescript
// types/allocation.ts
import { StrategyProposal } from "./strategy";

export interface AllocationConfig {
  minActivation: number;       // 이하 전략 무시 (예: 0.05)
  maxWeightPerSymbol: number;  // 종목 집중 상한 (예: 0.15)
  maxWeightPerFamily: number;  // 패밀리 예산 상한 (예: 0.50)
  method: "activation" | "riskparity" | "hrp";  // 기본 "activation"(v1)
  correlationLookback?: number;// v2 상관 추정 윈도우 (거래일)
}

export interface AllocationInput {
  proposals: readonly StrategyProposal[];
  /** v2 전용: 전략별 trailing 수익률 (상관 추정). 없으면 v1 패밀리 휴리스틱 */
  strategyReturns?: Readonly<Record<string, readonly number[]>>;
}

export interface MetaAllocation {
  weights: Readonly<Record<string, number>>;        // 최종 종목 상대비중, Σ ≤ 1
  strategyAlloc: Readonly<Record<string, number>>;  // 전략별 배분 (설명·로깅)
  reasons: string[];                                // "family trend capped" 등
}

export function allocate(
  input: AllocationInput,
  cfg: AllocationConfig
): MetaAllocation;
```

`allocate`는 순수 함수. `strategyReturns`가 없으면 자동으로 v1(활성도+패밀리)로
폴백 — 데이터가 부족한 초기에도 동작한다.

## 6. 검증 포인트 (validation.md 연계)

- **중복 제거 효과(핵심)**: 메타 적용 vs 단순 합산(naive Σ)을 비교.
  메타가 **유효 베팅 수(effective N)**↑, 집중도↓, 동일 수익 대비 MDD↓를 내는가?
  - 유효 베팅 수 ≈ `1 / Σ wᵢ²`(허핀달 역수) 또는 다양화 비율로 측정.
- **v1 vs v2**: 패밀리 휴리스틱만으로 충분한가, 상관행렬이 유의하게 개선하나?
  v2가 소표본에서 불안정하면(추정 오차) v1이 실전에서 더 나을 수 있다.
- **턴오버**: 리밸런싱 시 비중 변화량(`Σ|Δw|`). 거래비용과 직결 → 과도하면 페널티.
- **look-ahead 차단**: 상관 추정이 미래 수익률을 안 봤는지 단위 테스트로 못 박음.

## 7. 전체 파이프라인 — 계약 체인 닫기

이 문서로 전략 레이어들의 입출력 계약이 모두 연결된다.

```
① 국면 분류        classify(history)            → RegimeState.membership
        │
② 전략 풀          runPool(strategies, universe, regime)
        │                                        → StrategyProposal[]
        │            (각 전략: activation = Σ membership×affinity, 종목 비중)
        ▼
③ 메타 배분        allocate({ proposals }, cfg) → MetaAllocation.weights
        │            (전략 간 배분 + 상관 중복 제거 → 종목 상대비중 Σ≤1)
        ▼
④ 적극도 곱셈      computeAggressiveness(risk, cfg, sentiment?)
        │                                        → aggressiveness ∈ [0,1]
        │            finalGross[sym] = weights[sym] × aggressiveness
        ▼
⑤ 주문 실행(6)     규칙 기반으로 목표비중 → 실제 주문 (broker 비용 반영)
```

각 화살표가 `types/`의 타입 계약 하나다. 그래서 어느 레이어든 구현을 갈아끼워도
이 체인은 안 깨진다(architecture.md 모듈화 원칙).

## 8. v2 이후

- 상관행렬 추정 고도화(Ledoit-Wolf 수축, EWMA 공분산).
- 전략 간 + 종목 간 상관 이중 고려(현재는 전략 간 위주).
- 제약 최적화(목표 변동성 하 비중 최적화, turnover 패널티 포함).
- 강한 수축을 건 성과 가중(과최적화 통제 하에서만).
```
