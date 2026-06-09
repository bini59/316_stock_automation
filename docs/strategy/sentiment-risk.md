# 감성·리스크 → 적극도 (Sentiment & Risk → Aggressiveness)

> 이 레이어는 **방향이 아니라 크기**를 조절한다. 액셀·브레이크지 핸들이 아니다.
> 핸들(무엇을 살지)은 국면·전략 풀이 잡고, 여기선 "전체를 얼마나 세게 밟을지"
> 하나의 스칼라(적극도)만 정한다.

## 0. 절대 원칙 — AI는 참고자료일 뿐

이 레이어의 설계 1원칙: **시스템은 AI 없이 완결되어야 한다.**

- **규칙 기반 베이스라인이 단독으로 적극도를 산출한다.** AI(LLM 감성)가 전혀
  없어도, 꺼져 있어도, 응답이 실패해도 시스템은 정상 작동한다.
- **AI 감성은 베이스라인 위에 얹는, 경계가 명확한 보조 오버레이**일 뿐이다.
  베이스라인을 정해진 밴드 안에서만 미세조정한다. 시스템의 토대가 될 수 없다.
- **AI-free 모드는 임시 폴백이 아니라 1급 운영 모드**다(`useSentiment: false`).
  실거래를 이 모드로만 돌려도 완전한 전략이 된다. AI는 "엣지를 더하는" 역할만.
- **분리 원칙**: AI는 신호(점수)만 만든다. 그 신호를 적극도로 변환하고 매매로
  옮기는 건 전부 명확한 규칙. AI가 헛소리를 해도 규칙의 밴드·클램프가 막는다.

> overview.md: "순수 AI 예측 모델에 올인하지 않는다 ... 뼈대가 AI 없이도
> 작동하므로 리스크가 통제되고, AI는 엣지를 더하는 역할만 한다."
> architecture.md: "AI가 오작동해도 시스템이 통째로 무너지지 않게 한다."

## 1. 적극도란 무엇인가

**적극도(aggressiveness) ∈ [0, maxExposure]** — 포트폴리오 전체에 곱하는 단일
gross 스케일. `maxExposure`는 보통 **1.0(무레버리지)**.

- `1.0` = 전략·메타가 정한 비중을 그대로 100% 투입.
- `0.4` = 같은 종목 구성이되 전체 노출을 40%로 줄이고 60% 현금.
- `0.0` = 전량 현금(완전 방어).

방향·종목 구성은 건드리지 않는다. 비중 **벡터의 크기**만 키우고 줄인다.

### 레이어 경계 (vs 전략 풀 / 메타)

| 레이어 | 노출에 대한 역할 |
|--------|------------------|
| 전략 풀(3) | 전략-내부에서 현금 비중 조절(방어·현금 패밀리) |
| **감성·리스크(4, 여기)** | **포트폴리오 전체 gross에 곱하는 단일 스칼라** |
| 메타(5) | 전략 간 비중 분배(상대 비중) |

전략 풀의 현금 레이즈와 여기의 gross 축소는 **곱으로 중첩**된다(의도된
이중 방어). 둘 다 `[0,1]`로 클램프되므로 곱해도 안전 범위를 벗어나지 않는다.
crisis 같은 극단에서 두 겹으로 보수적이 되는 건 의도한 것.

## 2. 규칙 기반 베이스라인 (AI 0으로 완결)

세 가지 정량 브레이크의 **곱**. 가장 보수적인 요인이 지배하게 한다. 전부
"현재 시점까지" 데이터만 사용(look-ahead 차단).

```
A_vol    = clamp(targetVol / realizedVol, 0, maxExposure)   # ① 변동성 타겟팅
A_crisis = 1 − regime.membership.crisis                      # ② 위기 브레이크
A_dd     = ddBrake(drawdown)                                 # ③ 낙폭 브레이크
A_base   = clamp(A_vol × A_crisis × A_dd, 0, maxExposure)
```

### ① 변동성 타겟팅 — 핵심 엔진

목표 변동성을 정해두고, 실현변동성이 오르면 노출을 자동으로 줄인다.
시장이 거칠어지면 알아서 발을 떼는, AI 필요 없는 가장 강력한 리스크 제어.

```
A_vol = targetVol / realizedVol     (상한 maxExposure로 클램프)
```
예: `targetVol = 0.12`(연 12%), 시장 `realizedVol = 0.24` → `A_vol = 0.5`.
변동성이 평소의 2배가 되면 노출을 절반으로.

### ② 위기 브레이크

regime 레이어의 `crisis` 멤버십에 비례해 감쇠. crisis가 1로 점화되면
`A_crisis → 0`(전량 현금 수렴).

### ③ 낙폭 브레이크

포트폴리오 현재 낙폭이 임계를 넘으면 단계적으로 노출 축소(자본 보존).
```
ddBrake(dd) = 1.0           if dd < 0.10
            = 1 − (dd−0.10)/0.20   if 0.10 ≤ dd < 0.30   (선형 감쇠)
            = 0.0           if dd ≥ 0.30
```
−10%까진 그대로, −30%에서 노출 0. (CPPI 류의 단순화 버전.)

## 3. AI 감성 오버레이 — 경계 있는 미세조정

베이스라인을 **정해진 밴드 안에서만** 조정한다. AI는 곱셈 보정 한 줄로 들어온다.

```
s_eff = sentiment.score × sentiment.confidence       # 신뢰도 가중, -1..+1
adj   = (s_eff ≥ 0) ? (1 + sentimentMaxBoost × s_eff)    # 상방
                    : (1 + sentimentMaxCut  × s_eff)    # 하방(s_eff<0)
A     = clamp(A_base × adj, 0, maxExposure)
```

### 비대칭 밴드 — 보수 편향

낙관 오류가 비관 오류보다 비싸다(틀린 공격은 돈을 잃고, 틀린 방어는 기회만
놓친다). 그래서 **AI가 줄이는 건 크게, 키우는 건 작게** 허용한다.

| 방향 | 기본 한계 | 의미 |
|------|-----------|------|
| 상방 `sentimentMaxBoost` | **+0.15** | 극도 긍정이어도 베이스라인의 +15%까지만 |
| 하방 `sentimentMaxCut` | **−0.30** | 극도 부정이면 −30%까지 깎을 수 있음 |

즉 AI는 **신중함을 더할 권한은 넓고, 공격성을 더할 권한은 좁다.** AI가
오작동해 과도하게 낙관해도 시스템이 위험해지지 않는다.

## 4. 그레이스풀 디그레이데이션 — 언제 중립(0)으로 떨어지나

다음 중 하나라도 해당하면 `s_eff = 0`으로 강제 → **베이스라인만으로 작동**.

- `cfg.useSentiment === false` (AI 완전 배제 모드)
- `sentiment`가 **없음**(undefined) — 입력 자체가 안 들어옴
- **신선도 초과**: `now − sentiment.asOf > freshnessMs` (낡은 감성은 무시)
- `confidence`가 임계 미만(예: < 0.2) — 근거 빈약
- 감성 파이프라인 예외/타임아웃 (호출부에서 잡아 미전달)

핵심: 이 모든 경우의 결과는 **"안전한 베이스라인"**이지 시스템 정지가 아니다.
AI는 있으면 보태고, 없으면 조용히 빠진다.

## 5. 인터페이스

```typescript
// types/sentiment.ts
import { RegimeState } from "./regime";

/** AI(LLM)가 산출하는 감성 신호 — 이 레이어의 유일한 AI 입력 */
export interface SentimentSignal {
  score: number;       // -1 (극도 부정) .. +1 (극도 긍정)
  confidence: number;  // 0..1, 근거의 강도
  asOf: number;        // Unix epoch (ms), 신선도 판단용
  sources?: number;    // 근거 기사·공시 수 (선택, 로깅용)
}

/** 적극도 산출에 필요한 정량 리스크 입력 (전부 현재 시점까지) */
export interface RiskInputs {
  realizedVol: number; // 연율화 실현변동성
  drawdown: number;    // 현재 낙폭 0..1
  regime: RegimeState; // crisis 멤버십 등
}

export interface AggressivenessConfig {
  targetVol: number;          // 예: 0.12
  maxExposure: number;        // 보통 1.0 (무레버리지)
  useSentiment: boolean;      // false → AI 완전 배제 (1급 모드)
  sentimentMaxBoost: number;  // 예: 0.15 (비대칭 상방)
  sentimentMaxCut: number;    // 예: 0.30 (비대칭 하방)
  freshnessMs: number;        // 이 시간 지난 감성은 중립 처리
  minConfidence: number;      // 예: 0.2
}

export interface AggressivenessResult {
  aggressiveness: number;  // 최종 gross 스케일 0..maxExposure
  base: number;            // AI 빼고 규칙만으로 산출한 값
  sentimentApplied: number;// 실제 반영된 감성 보정율 (1.0이면 미반영)
  reasons: string[];       // "vol-target 0.5", "sentiment stale" 등 설명
}

/**
 * sentiment는 optional — 없어도 동작한다(베이스라인 산출).
 * AI 미사용/실패가 정상 경로의 일부.
 */
export function computeAggressiveness(
  risk: RiskInputs,
  cfg: AggressivenessConfig,
  sentiment?: SentimentSignal,
  now?: number
): AggressivenessResult;
```

`computeAggressiveness`는 순수 함수. `sentiment` 인자가 `undefined`여도, 또는
`useSentiment=false`여도 `base`를 그대로 반환한다.

## 6. AI는 무엇을 점수화하나 (감성 파이프라인)

이 레이어가 소비하는 `SentimentSignal`을 만드는 쪽. **본 레이어 바깥의 보조
모듈**이며, 실패해도 본 레이어가 중립으로 흡수한다.

- **입력**: 뉴스 헤드라인, 기업 공시(8-K 등), 거시·지정학 이벤트 텍스트.
- **처리**: LLM으로 긍정/부정·강도·신뢰도 점수화. 가격 시계열을 딥러닝에
  넣어 주가를 "예측"하는 접근은 과최적화에 취약해 **지양**(overview.md).
  AI는 "예측"이 아니라 "텍스트 정보의 구조화"에만 쓴다.
- **출력**: `{ score, confidence, asOf, sources }`. 종목 단위가 아니라
  **시장 전체 감성** 하나(톱다운 일관). 종목별 감성은 v2.
- **신선도 스탬프 필수**: `asOf`로 낡은 신호를 4절 규칙이 걸러낸다.

## 7. 검증 — AI가 정말 엣지를 더하나

이 레이어는 AI 가치 증명과 안전성 증명을 둘 다 해야 한다.

1. **A/B (핵심)**: `useSentiment` on vs off로 동일 기간 백테스트.
   - AI off가 이미 견고한 성과를 내는가? (토대 검증 — 안 나오면 베이스라인부터 고친다)
   - AI on이 샤프·MDD를 **유의하게** 개선하는가? 미미하면 복잡도만 늘린 것 → 뺀다.
2. **강건성**: 감성 신호에 일부러 노이즈/지연/누락을 주입했을 때 성과가
   급락하지 않는가? (밴드·디그레이데이션이 제 역할을 하는지)
3. **비대칭 검증**: 상방 보정을 0으로 묶어도(하방만 허용) 성과가 유지되는지 —
   AI의 가치가 "공격"이 아니라 "방어 타이밍"에 있을 가능성.
4. **look-ahead 차단**: 감성 `asOf`가 의사결정 시점 이전 데이터로만 만들어졌는지
   단위 테스트로 못 박는다(뉴스는 특히 미래 누출이 흔하다).

## 8. 다음 레이어로의 계약

- **메타 레이어(5)** 가 전략 풀의 `StrategyProposal[]`을 합쳐 최종 종목별
  상대 비중을 만든 뒤, **그 위에 본 레이어의 `aggressiveness` 스칼라를 곱한다.**
  순서: 상대 비중(메타) × 적극도(여기) = 최종 gross 비중.
- 본 레이어는 `RegimeState`(crisis 멤버십)와 정량 리스크 입력에만 의존.
  분류기·전략 구현 내부엔 의존하지 않는다.

## 9. v2 이후

- 종목별 감성(섹터·개별 이벤트) → 비중 미세 틸트 (단, 방향 결정권은 안 줌).
- 지정학 리스크 지수의 정량화(이벤트 DB) 통합.
- 변동성 타겟팅을 EWMA/GARCH 추정으로 정교화.
- 감성 신호의 다중 소스 앙상블 + 소스 신뢰도 가중.
