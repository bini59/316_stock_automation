# 국면 분류 레이어 (Regime Classification)

> 아키텍처상 "시스템의 심장부이자 가장 어려운 곳". 이 레이어가 흔들리면
> 위층(전략 풀·메타)이 전부 흔들린다. 그래서 화려한 모델보다 **투명하고
> 깨지지 않는 규칙**을 우선한다.

## 0. 범위 확정

- **대상 시장**: 미국 주식 (US equities)
- **판정 방식**: **톱다운 / 지수 기반 (A안)**. 시장 전체의 단일 국면을
  지수 하나로 판정하고, 모든 종목이 그 국면을 공유한다. 종목별 개별 국면은
  잡지 않는다(노이즈·복잡도 대비 이득이 작음). 종목 선택은 전략 풀의 몫.
- **기준 자산**: `^GSPC`(S&P 500) 또는 `SPY`. 거래 가능한 프록시로는 SPY,
  계산용 순수 지수로는 ^GSPC. 둘 중 데이터 품질 좋은 쪽을 `loader`가 공급.
- **보조 자산**: `^VIX`(변동성 지수), `^VIX3M`(3개월 VIX) — 텀 구조용.

## 1. 절대 원칙 (이 레이어에 한정)

1. **연속 스펙트럼 + 히스테리시스.** 칼같이 3분할하지 않는다.
   출력은 단일 라벨이 아니라 **연속 상태 벡터 + 소프트 멤버십**.
2. **후행성 인정.** 국면은 후행적으로만 또렷해진다. 전환 시점의 신호 지연과
   whipsaw(깜빡임)를 어떻게 죽이느냐가 이 레이어의 성패다.
3. **look-ahead 차단.** `classify()`는 "현재 시점까지"의 history만 본다.
   백분위·평활 등 모든 통계는 trailing window로만 계산한다(미래 구간 금지).
4. **규칙 기반.** HMM·딥러닝은 척추에 넣지 않는다. 단, 인터페이스를
   교체 가능하게 빼두어 나중에 ML 분류기를 A/B로 끼울 수 있게 한다.

## 2. 출력 — 상태 벡터

```typescript
// types/regime.ts
export type RegimeLabel = "bull" | "bear" | "chop" | "crisis";

export interface RegimeState {
  asOf: number;             // Unix epoch (ms), 이 판정의 기준 시점

  /** 방향 축: -1 (강한 하락) .. 0 (방향 없음) .. +1 (강한 상승) */
  trend: number;

  /** 변동성 축: 0 (평온) .. 1 (패닉) */
  volatility: number;

  /** 추세 품질(Kaufman ER): 0 (톱질) .. 1 (깨끗한 추세) */
  trendQuality: number;

  /** 명명된 국면에 대한 소프트 소속도. 합 = 1 */
  membership: Record<RegimeLabel, number>;

  /** 가장 유력한 라벨 (히스테리시스 적용된 하드 라벨) */
  label: RegimeLabel;

  /** 국면이 얼마나 또렷한가: 0 (애매) .. 1 (단호). 1 - 정규화 엔트로피 */
  confidence: number;
}
```

핵심은 `membership`이다. `{ bull: 0.7, chop: 0.3, bear: 0, crisis: 0 }`처럼
나오면 전략 풀이 **하드 스위치 없이 가중 블렌딩**으로 받는다. 경계에서
깜빡여도 비중이 70→60으로 부드럽게 움직일 뿐, 포지션을 통째로 청산했다
다시 사는 일이 없다. whipsaw를 구조적으로 죽이는 장치.

`label`은 라벨이 꼭 필요한 소비자(로깅·리포트·하드 룰)를 위한 편의 출력일 뿐,
**핵심 계약은 `membership`**이다.

## 3. 교체 가능한 인터페이스

`Strategy`와 같은 철학. 분류기 구현을 갈아끼워도 위층은 그대로.

```typescript
// types/regime.ts
import { PriceSeries } from "./market";

/** 거시·보조 시계열. 국면 판정 보조 입력 (전부 현재 시점까지) */
export interface MacroContext {
  vix?: PriceSeries;        // ^VIX
  vix3m?: PriceSeries;      // ^VIX3M
  // v2: breadth(200일선 위 종목 비율), 금리 스프레드 등
}

export interface RegimeClassifier {
  readonly name: string;
  readonly params: Readonly<Record<string, number>>;

  /**
   * history: 기준 지수의 "현재 시점까지" 바 배열.
   * ctx: 보조 시계열도 동일하게 현재 시점까지로 정렬되어 들어온다.
   * 미래 데이터 접근은 타입·호출 규약 수준에서 차단.
   */
  classify(history: PriceSeries, ctx?: MacroContext): RegimeState;
}
```

기본 구현은 `RuleBasedRegimeClassifier`. (HMM 버전은 `HmmRegimeClassifier`로
나중에 추가하고, 동일 인터페이스로 검증 비교한다.)

## 4. 입력 신호 (미국 주식 특화)

모든 통계는 trailing window로만 계산한다. 백분위는 후행 1~2년 분포 기준.

### 4.1 추세 축

| 신호 | 정의 | 의미 |
|------|------|------|
| `d200` | `(close − SMA200) / SMA200` | 200일선 대비 위치(정규화) |
| `slope200` | `(SMA200_t − SMA200_{t−20}) / SMA200_{t−20}` | 200일선 기울기(20일) |
| `ER` | Kaufman Efficiency Ratio (아래) | 추세 **품질** (0=톱질, 1=깨끗) |

**Kaufman Efficiency Ratio** (window `n`, 기본 30):
```
ER = |close_t − close_{t−n}|  /  Σ_{i=t−n+1..t} |close_i − close_{i−1}|
```
순수 이동거리 ÷ 총 경로길이. 같은 +5% 상승이어도 일직선이면 ER≈1,
지그재그면 ER≈0.2. **횡보(chop) 판정의 핵심 열쇠** — 방향만으로는 추세장과
톱질장을 구분 못 하기 때문.

### 4.2 변동성 축

| 신호 | 정의 | 의미 |
|------|------|------|
| `rv20` | 일간 로그수익률 20일 표준편차 × √252 | 연율화 실현변동성 |
| `rvPct` | `rv20`의 후행 1~2년 백분위 (0..1) | 변동성 상대 수준 |
| `vixPct` | `^VIX`의 후행 1~2년 백분위 (0..1) | 시장 내재 공포 상대 수준 |
| `termStress` | `clamp(VIX / VIX3M − 1, 0, 0.3) / 0.3` | 텀 구조 역전(백워데이션) = 패닉 |

VIX 텀 구조가 역전(`VIX > VIX3M`)되면 시장이 단기 패닉에 빠진 신호 —
미국 주식만의 강력한 선행 스트레스 지표. 평시엔 콘탱고(VIX < VIX3M)라 0.

## 5. 점수 → 멤버십 계산

### 5.1 연속 축 산출

```
# 표준화(z): 후행 1~2년 분포 기준. 이상치는 ±3σ로 윈저라이즈.
trendRaw   = w_d * z(d200) + w_s * z(slope200)
trend      = tanh(k_t * trendRaw)                  # -1..+1
trendQuality = ER                                  # 0..1

volatility = clamp(0.5*rvPct + 0.4*vixPct + 0.1*termStress, 0, 1)   # 0..1
```

`tanh`로 부드럽게 -1..+1로 눌러 극단값이 멤버십을 지배하지 않게 한다.

### 5.2 소프트 멤버십 (어피니티 → 정규화)

각 국면에 대한 비음(非負) 어피니티를 구하고 합으로 나눠 정규화.

```
pos(x)   = max(0, x)
hi(v, c, s) = sigmoid((v − c) / s)        # v가 임계 c를 부드럽게 넘는 정도

a_crisis = hi(volatility, 0.80, 0.06) * (1 + 0.5*pos(−trend))
a_bull   = pos(trend)  * (1 − volatility) * (0.5 + 0.5*ER)
a_bear   = pos(−trend) * (1 − a_crisis)
a_chop   = (1 − |trend|) * (1 − ER) * (1 − a_crisis)

S = a_bull + a_bear + a_chop + a_crisis + ε
membership = { bull: a_bull/S, bear: a_bear/S, chop: a_chop/S, crisis: a_crisis/S }
```

직관:
- **bull**: 추세 양(+)이고, 변동성 낮고, 추세가 깨끗할수록 강함.
- **bear**: 추세 음(−)이되 crisis가 아닐 때(완만한 하락·약세).
- **crisis**: 변동성이 0.8 임계를 넘으면 방향 불문 점화, 하락이면 증폭.
  (고변동 패닉은 bull/bear와 다른 운용을 요구하므로 분리)
- **chop**: 방향 약하고(|trend|↓) 추세 품질 낮을 때(ER↓). 톱질장.

```
confidence = 1 − entropy(membership) / log(4)     # 0(균등)..1(한 곳에 집중)
```

## 6. 히스테리시스 — whipsaw 3중 방어

1. **소프트 멤버십** (5.2) — 하드 경계 자체를 없앤다. 1차이자 가장 강력한 방어.
2. **입력 평활** — `trend`, `volatility`를 멤버십 계산 **전에** EMA(span 5~10일)로
   평활. 하루치 노이즈로 국면이 튀지 않게.
3. **하드 라벨 슈미트 트리거 + 체류시간** — `label`(argmax) 전환은:
   - 새 후보의 membership > **0.50** AND 현재 라벨의 membership < **0.40** 일 때만,
   - 그리고 새 후보가 **K일(기본 3일) 연속** 1위를 유지했을 때만 전환.
   진입·이탈 임계의 갭(0.50 vs 0.40)이 경계 깜빡임을 흡수.

`membership` 자체는 매일 부드럽게 갱신되고, `label`만 히스테리시스로 끈끈하게
움직인다. 전략 풀은 `membership`을 쓰므로 라벨 지연의 영향을 받지 않는다.

## 7. 기본 파라미터 (초기값, 검증으로 조정)

| 파라미터 | 기호 | 기본값 | 비고 |
|----------|------|--------|------|
| 장기 MA 기간 | `SMA200` | 200 | 거래일 |
| 기울기 룩백 | — | 20 | 거래일 |
| ER 윈도우 | `n` | 30 | 거래일 |
| 실현변동성 윈도우 | `rv20` | 20 | 거래일 |
| 백분위 룩백 | — | 378 (≈1.5년) | rvPct·vixPct 분포 |
| trend 가중 | `w_d, w_s` | 0.6, 0.4 | 합 1 권장 |
| trend 압축 | `k_t` | 0.8 | tanh 기울기 |
| crisis 임계 | `c` | 0.80 | 변동성 백분위 |
| crisis 폭 | `s` | 0.06 | sigmoid 완만도 |
| 입력 EMA span | — | 7 | 평활 |
| 라벨 진입/이탈 | — | 0.50 / 0.40 | 슈미트 트리거 |
| 라벨 체류 | `K` | 3 | 거래일 |

> 이 값들은 **in-sample에서 탐색**하고 **out-of-sample에서 검증**한다.
> 너무 많이 만지면 과최적화(validation.md 1번 함정). 파라미터 수를 의도적으로
> 적게 유지한다.

## 8. 검증 — 정답 라벨이 없는 문제

국면에는 ground truth가 없다("그때가 상승장이었다"는 사후 해석). 따라서
직접 정확도가 아니라 **간접·행동 기반**으로 검증한다.

1. **유용성(핵심)** — 국면 조건부 전략 스위칭이 always-on(국면 무시) 대비
   샤프↑·MDD↓를 내는가? 이걸로 레이어의 존재 가치를 증명.
2. **whipsaw 비용** — 라벨 전환 횟수·멤버십 턴오버(`Σ|Δmembership|`).
   너무 잦으면 거래비용이 수익을 갉아먹으므로 페널티 지표로 추적.
3. **지속성** — 각 국면 평균 체류 기간. 며칠짜리 "상승장"이 빈발하면
   히스테리시스가 약한 것. 상식적 분포(수 주~수 개월)인지 확인.
4. **위기 적시성** — 과거 알려진 충격(2018Q4, 2020-03, 2022)에서 `crisis`
   멤버십이 폭락 **전후**로 충분히 점화됐는가(후행성 한계 내에서).

look-ahead 차단 검증: `classify(history.slice(0, i+1))`가 i 시점 이후
데이터에 절대 의존하지 않음을 단위 테스트로 못 박는다(백분위·EMA 포함).

## 9. v2 이후 (지금은 범위 밖)

- **브레드스**: S&P 구성종목 중 200일선 위 비율. 지수는 버티는데 내부가
  무너지는 "약한 상승" 탐지. 구성종목 시계열 필요.
- **거시 스프레드**: 장단기 금리차(10Y−2Y), 신용 스프레드(HY OAS).
- **HMM/Markov-switching 분류기**: 동일 `RegimeClassifier` 인터페이스로
  구현해 규칙 버전과 out-of-sample 비교. 척추 교체가 아니라 후보 추가.

## 10. 다음 레이어로의 계약

전략 풀(`strategy-pool.md`)은 이 레이어에서 **`RegimeState.membership`**만
받는다. 국면별 전략의 비중 = 멤버십 가중합. `label`이나 내부 신호(d200 등)에
의존하지 않는다 — 그래야 분류기를 갈아끼워도 전략 풀이 안 깨진다.
```
