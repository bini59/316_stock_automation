# 핵심 인터페이스

이 인터페이스들이 전체 시스템의 계약(contract)이다. 이것만 지키면 전략·엔진·
검증을 얼마든지 갈아끼울 수 있다. 변경 시 영향 범위가 크므로 신중히 다룬다.

## 시장 데이터

```typescript
// types/market.ts
export interface Bar {
  timestamp: number;   // Unix epoch (ms)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type PriceSeries = readonly Bar[];
```

## 전략

look-ahead bias를 막는 설계가 여기 들어간다. `next()`에 "현재 시점까지"의
history만 넘기므로, 전략은 구조적으로 미래 데이터에 접근할 수 없다.

```typescript
// types/strategy.ts
export type SignalAction = "BUY" | "SELL" | "HOLD";

export interface Signal {
  action: SignalAction;
  /** 0~1, 포지션 크기 비중. 메타/적극도 레이어가 나중에 조절 */
  strength: number;
}

export interface Strategy {
  readonly name: string;

  /**
   * 핵심 규칙: history는 "현재 시점까지"만 담긴 배열.
   * 미래 데이터는 타입 수준에서 아예 접근 불가하게 만든다.
   * 이게 look-ahead bias를 막는 1차 방어선.
   */
  next(history: PriceSeries): Signal;

  /** 파라미터를 외부에서 주입 (최적화 루프가 갈아끼움) */
  readonly params: Readonly<Record<string, number>>;
}
```

백테스터가 루프를 돌면서 `history.slice(0, i + 1)`로 잘라 넘겨주면,
전략 코드가 미래를 볼 방법 자체가 없어진다.

## 결과·지표

```typescript
// types/result.ts
export interface Trade {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;          // 비용 차감 후 손익
}

export interface Metrics {
  totalReturn: number;
  sharpe: number;
  maxDrawdown: number;  // 0~1 (예: 0.32 = -32%)
  winRate: number;
  tradeCount: number;
}

export interface BacktestResult {
  equityCurve: number[];   // 시점별 자본
  trades: Trade[];
  metrics: Metrics;
}
```

## 브로커 (비용 모델)

비용을 `Broker`로 분리해 거래비용을 빼먹는 실수를 구조적으로 막는다.
백테스터가 체결할 때 반드시 이걸 거친다.

> 아래는 **한국 주식 기준** 초기 골격이다. 미국 주식은 매도세가 없는 대신
> 환전 스프레드·SEC fee류가 붙어 비용 구조가 다르다. 시장별 분리(`market: "KR"|"US"`)와
> 토스 `/commissions` 실측 캘리브레이션은 `execution-and-data.md` 7절 참조.

```typescript
// engine/broker.ts
export interface BrokerConfig {
  commissionRate: number;  // 예: 0.00015 (0.015%)
  taxRate: number;         // 매도세, 예: 0.0018
  slippageRate: number;    // 체결 오차, 예: 0.001
}

export class Broker {
  constructor(private cfg: BrokerConfig) {}

  /** 매수 체결가: 슬리피지로 약간 불리하게 */
  fillBuy(price: number): number {
    return price * (1 + this.cfg.slippageRate);
  }

  fillSell(price: number): number {
    return price * (1 - this.cfg.slippageRate);
  }

  /** 거래당 비용 (수수료 + 매도세) */
  cost(side: "BUY" | "SELL", notional: number): number {
    const commission = notional * this.cfg.commissionRate;
    const tax = side === "SELL" ? notional * this.cfg.taxRate : 0;
    return commission + tax;
  }
}
```

## 백테스터 골격

위 계약들을 엮는 시뮬레이션 루프. 단일 종목 기준이며, 다중 종목 확장 시
portfolio.ts로 포지션 관리를 분리한다.

```typescript
// engine/backtester.ts
import { PriceSeries } from "../types/market";
import { Strategy } from "../types/strategy";
import { BacktestResult, Trade } from "../types/result";
import { Broker } from "./broker";
import { computeMetrics } from "../validation/metrics";

export function backtest(
  strategy: Strategy,
  data: PriceSeries,
  broker: Broker,
  initialCapital: number
): BacktestResult {
  let cash = initialCapital;
  let position = 0;            // 보유 수량
  let entryPrice = 0;
  let entryTime = 0;
  const equityCurve: number[] = [];
  const trades: Trade[] = [];

  for (let i = 0; i < data.length; i++) {
    // 현재 시점까지만 전략에 노출 → 미래 차단
    const history = data.slice(0, i + 1);
    const signal = strategy.next(history);
    const bar = data[i];

    if (signal.action === "BUY" && position === 0) {
      const fillPrice = broker.fillBuy(bar.close);
      const notional = cash * signal.strength;
      const qty = notional / fillPrice;
      cash -= notional + broker.cost("BUY", notional);
      position = qty;
      entryPrice = fillPrice;
      entryTime = bar.timestamp;
    } else if (signal.action === "SELL" && position > 0) {
      const fillPrice = broker.fillSell(bar.close);
      const notional = position * fillPrice;
      cash += notional - broker.cost("SELL", notional);
      trades.push({
        entryTime,
        exitTime: bar.timestamp,
        entryPrice,
        exitPrice: fillPrice,
        pnl: notional - position * entryPrice,
      });
      position = 0;
    }

    // 시점별 평가자산 = 현금 + 보유 평가액
    equityCurve.push(cash + position * bar.close);
  }

  return { equityCurve, trades, metrics: computeMetrics(equityCurve, trades) };
}
```
