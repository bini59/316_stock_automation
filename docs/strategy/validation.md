# 검증·테스트 전략

백테스트의 가장 큰 거짓말은 "과거에 잘 됐으니 미래에도 될 거야"다.
검증 프레임워크의 존재 이유는 이 거짓말을 걸러내는 것. 그래서 전략 알고리즘보다
검증 프레임워크를 먼저 신뢰 가능하게 만든다.

검증은 단계별 관문(gate)이다. 전략 후보가 각 관문을 통과해야 다음으로
넘어가고, 하나라도 못 넘으면 폐기한다.

## 5개 관문

### 1. in-sample 학습 (과거 데이터로 전략 만들기)

파라미터(이동평균 기간, 임계값 등)를 과거 데이터로 탐색·최적화한다.
여기서 성과가 좋은 건 당연하므로 **의미 없다**. 함정은 과최적화(curve
fitting) — 파라미터를 너무 많이 만지면 과거 노이즈까지 외워버린다.

### 2. out-of-sample 검증 (안 본 데이터로 시험)

핵심 관문. 데이터를 처음부터 둘로 나눠두고(보통 7:3 또는 8:2), in-sample에서
한 번도 안 본 기간으로 시험한다. in-sample에선 좋았는데 여기서 무너지면
과최적화된 가짜 전략. **out-of-sample 데이터를 보면서 전략을 수정하면 안 된다**
— 보는 순간 그 데이터도 in-sample이 된다.

### 3. 워크포워드 분석 (현실에 가장 가까운 검증)

단순 분할보다 한 단계 위. "과거 2년 학습 → 다음 6개월 검증 → 창을 6개월
앞으로 굴려 반복". 실제 운영에서 주기적으로 모델을 재학습하는 환경을 가장
비슷하게 흉내 낸다. 여러 구간에서 일관되게 성과가 나오는지 본다.

### 4. 거래비용·슬리피지 반영 (가장 많이 죽는 관문)

초보 백테스트가 무너지는 1순위. 수수료·세금(국내 주식 매도세)·슬리피지(체결
오차)를 빼먹으면 수익률이 한참 부풀려진다. 거래가 잦을수록 비용이 수익을 통째로
갉아먹는다. 보수적으로 잡을 것. (구현은 `engine/broker.ts`로 강제.)

### 5. 실거래 배포 (그래도 소액부터)

네 관문을 다 통과해도 전액 투입 금물. 페이퍼 트레이딩이나 소액 실계좌로
시작해, 백테스트 성과와 실거래 성과가 비슷한지(라이브-백테스트 일치도)
확인하며 점진적으로 늘린다.

## 꼭 피해야 할 함정 3가지

1. **미래 참조(look-ahead bias)** — 그 시점에 알 수 없던 정보를 쓰는 실수.
   가장 흔하고 치명적. 타입 수준에서 차단한다(전략에 현재까지 데이터만 전달).
2. **생존 편향(survivorship bias)** — 지금 살아남은 종목만으로 백테스트하면
   상장폐지 종목이 빠져 수익률이 부풀려진다. 당시 존재한 모든 종목 데이터 필요.
3. **다중 검정 함정(multiple testing)** — 전략 100개를 만들면 그중 5개쯤은
   순전히 운으로 잘 나온다. 이를 "발견"으로 착각 금지. 검증한 전략 개수를
   기록하고 통계적으로 보정(더 엄격한 기준)한다.

## 성과 지표

단순 수익률만 보지 않는다. 함께 본다:

- **샤프 비율** — 위험 대비 수익
- **최대 낙폭(MDD)** — 고점 대비 얼마나 빠졌나 (수익률 높아도 중간에 50%
  빠지는 전략은 실제로 버티기 어렵다)
- **승률과 손익비**

## 합격 기준 (gate)

```typescript
// validation/gates.ts
import { Metrics } from "../types/result";

export interface GateCriteria {
  minSharpe: number;
  maxDrawdown: number;   // 허용 최대 낙폭
  minTradeCount: number; // 표본이 너무 적으면 신뢰 불가
}

export interface GateResult {
  passed: boolean;
  reasons: string[];     // 실패 사유 기록
}

export function evaluateGate(m: Metrics, c: GateCriteria): GateResult {
  const reasons: string[] = [];
  if (m.sharpe < c.minSharpe) reasons.push(`Sharpe ${m.sharpe.toFixed(2)} < ${c.minSharpe}`);
  if (m.maxDrawdown > c.maxDrawdown) reasons.push(`MDD ${m.maxDrawdown.toFixed(2)} > ${c.maxDrawdown}`);
  if (m.tradeCount < c.minTradeCount) reasons.push(`표본 부족 (${m.tradeCount})`);
  return { passed: reasons.length === 0, reasons };
}
```
