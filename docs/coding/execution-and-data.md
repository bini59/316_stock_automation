# 계좌 상태 · 주문 실행 (Account State & Execution)

> 데이터 레이어(①)의 **계좌 상태**와 주문 실행 레이어(⑥)를 구체화한다.
> 전략 스택은 "포트폴리오가 이렇게 생겨야 한다"는 **목표비중**만 만든다.
> 실제 주문은 **목표 ↔ 현재 계좌의 차이를 정산(reconcile)**해서 나온다.
> 브로커 구현체는 **토스증권 Open API**. 단, 전략 스택은 토스를 몰라야 한다.

## 0. 핵심 원칙

1. **target-weight 시스템.** 출력은 "OOO를 사라"가 아니라 "포트폴리오 목표
   상태". 주문 = `목표 − 현재`. (사용자 질문: 안 가진 종목도 목표에 들면 산다.)
2. **브로커 추상화.** 전략·엔진은 추상 인터페이스(`AccountSource`,
   `MarketDataSource`, `OrderExecutor`)에만 의존. 토스는 그 구현체 하나.
   백테스트는 시뮬레이션 구현체. **둘이 같은 정산 로직을 공유**한다.
3. **샌드박스 없음 → 모드로 안전 확보.** 토스는 페이퍼트레이딩 환경이 없다.
   그래서 **dry-run 모드**(실계좌·실시세를 읽되 주문은 계산·로깅만)가
   페이퍼트레이딩을 대신한다. 안전장치가 1급 시민.
4. **look-ahead 차단 유지.** 백테스트의 계좌·시세 소스도 "현재 시점까지"만
   노출한다(시뮬레이션 구현체가 강제).

## 1. 실행 모드 (샌드박스 부재 대응)

검증 관문(validation.md 5번)을 모드로 구현한다. 단계적으로만 승급.

| 모드 | 계좌 상태 | 시세 | 주문 | 용도 |
|------|-----------|------|------|------|
| `BACKTEST` | 시뮬레이션 | 과거 캔들 | 시뮬레이션 체결 | 전략 검증 |
| `DRY_RUN` | **실계좌(토스)** | **실시세(토스)** | **계산·로깅만, 미제출** | 페이퍼 대체. 파이프라인을 실조건에서 무위험 검증 |
| `LIVE_SMALL` | 실계좌 | 실시세 | **실제 제출(소액 한도)** | 백테스트 vs 실거래 일치도 확인 |
| `LIVE` | 실계좌 | 실시세 | 실제 제출 | 점진 증액 |

**DRY_RUN이 핵심**: 실제 보유·현금·가격을 읽어 주문까지 *계산*하지만
제출 직전에 멈춘다. 라이브 데이터 포맷·정산 로직·레이트리밋을 돈 안 걸고 검증.

## 2. 계좌 상태 타입

```typescript
// types/account.ts
export interface Holding {
  symbol: string;
  quantity: number;
  avgPrice: number;     // 평균 매입가 (해당 종목 통화)
  marketValue: number;  // 현재 평가액 (계좌 기준통화로 환산)
  currency: string;     // "KRW" | "USD"
}

export interface AccountState {
  accountSeq: string;
  baseCurrency: "USD";                       // USD 단일 통화로 운용 (결정)
  cash: number;                              // 가용 현금 (USD)
  holdings: Readonly<Record<string, Holding>>;
  nav: number;                               // 관리 순자산 (아래 정의)
  asOf: number;                              // 조회 시점
}
```

**통화 결정**: 전부 **USD 단일 통화**로 생각한다. KRW 환산·환손익 추적은
범위 밖(미루기). 미국 주식만 다루므로 FX 레이어 없이 단순하게 간다.

**NAV 정의(유니버스 한정 운용과 연동)**: 시스템은 유니버스 안만 손대므로
사이징 분모 NAV = **현금 + 유니버스 보유 평가액**(= 관리 자산). 유니버스 밖
보유는 NAV에서 제외하고 건드리지 않는다. 목표금액 = `targetWeight × nav × aggressiveness`.

## 3. 추상 인터페이스 (브로커 무관)

```typescript
// types/broker-port.ts
import { PriceSeries } from "./market";
import { AccountState } from "./account";
import { Order, OrderResult } from "./order";

export interface AccountSource {
  getState(): Promise<AccountState>;          // 현금+보유 (토스: holdings+buying-power)
}

export interface MarketDataSource {
  candles(symbol: string, from: number, to: number): Promise<PriceSeries>;
  currentPrice(symbol: string): Promise<number>;
}

export interface OrderExecutor {
  /** dry-run이면 제출하지 않고 계획만 반환 */
  submit(orders: readonly Order[], mode: ExecMode): Promise<OrderResult[]>;
}

export type ExecMode = "DRY_RUN" | "LIVE_SMALL" | "LIVE";
```

구현체: `TossAccountSource`, `TossMarketData`, `TossOrderExecutor` /
`SimulatedAccount`, `SimulatedMarketData`, `SimulatedExecutor`.

## 4. 정산 — 목표 ↔ 현재 → 주문

```typescript
// engine/reconcile.ts (백테스트·실거래 공용)
export interface Order {
  symbol: string;
  side: "BUY" | "SELL";
  notional: number;     // 금액 기반 (토스 amount-based 주문에 직결)
  reason: string;
}

export function reconcile(
  target: Readonly<Record<string, number>>,  // 메타×적극도 적용된 목표비중
  account: AccountState,
  universe: ReadonlySet<string>,             // 시스템이 손대는 종목 범위 (결정)
  cfg: ReconcileConfig
): Order[] {
  // 유니버스 안에서만 정산한다. 유니버스 밖 보유는 절대 건드리지 않는다.
  const symbols = new Set(
    [...Object.keys(target), ...Object.keys(account.holdings)].filter((s) => universe.has(s))
  );
  const orders: Order[] = [];
  for (const sym of symbols) {
    const targetValue  = (target[sym] ?? 0) * account.nav;  // nav = 관리 자산
    const currentValue = account.holdings[sym]?.marketValue ?? 0;
    const delta = targetValue - currentValue;

    // 무거래 밴드: 미세 드리프트로 churn 방지 (거래비용 통제)
    if (Math.abs(delta) < cfg.minTradeNotional) continue;

    orders.push({
      symbol: sym,
      side: delta > 0 ? "BUY" : "SELL",
      notional: Math.abs(delta),
      reason: target[sym] === undefined ? "exit (not in target)" : "rebalance",
    });
  }
  return orders;
}
```

핵심 장치:
- **금액 기반 주문**(`notional`) — 토스가 amount-based 주문을 지원해 주식 수
  반올림·단주 로직이 거의 사라진다. target-weight 시스템과 궁합이 좋다.
- **무거래 밴드**(`minTradeNotional`) — 비중이 1%p 흔들렸다고 매번 거래하면
  비용이 수익을 갉아먹는다(validation.md 4번). 임계 이하 차이는 무시.

## 5. 토스증권 API 매핑

Base: `https://openapi.tossinvest.com` · 인증: OAuth2 Client Credentials
(`POST /oauth2/token`) · 계좌/주문 호출엔 `X-Tossinvest-Account: {accountSeq}` 헤더.

| 우리 메서드 | 토스 엔드포인트 | 비고 |
|-------------|-----------------|------|
| `AccountSource.getState` | `GET /api/v1/holdings` + `GET /api/v1/buying-power` + `GET /api/v1/accounts` | 보유·현금·계좌 |
| `MarketDataSource.candles` | `GET /api/v1/candles` | OHLCV. **과거 데이터 깊이 미확인 → 6절** |
| `MarketDataSource.currentPrice` | `GET /api/v1/prices` | 실시간 시세 |
| `OrderExecutor.submit` | `POST /api/v1/orders` (`/modify`, `/cancel`) | amount/qty 기반 |
| 매도가능수량 검증 | `GET /api/v1/sellable-quantity` | 매도 전 가드 |
| 비용 캘리브레이션 | `GET /api/v1/commissions` | broker 비용모델 실측 |
| 거래 캘린더·환율 | Market Information | 휴장일·USD→KRW |

레이트리밋: 인증 5/s, 시세 10/s, 주문 6/s(09:00–09:10 KST는 3/s), 계좌 1–5/s.
중·저빈도 리밸런싱엔 충분. 429는 `Retry-After` + 지수 백오프.
**REST only(WebSocket 없음)** → 실시간은 폴링.

## 6. 결정 사항 / 미정

**확정된 결정:**

1. **유니버스 밖 보유 = 손대지 않음** ✅ — 시스템은 유니버스 안만 정산한다
   (`reconcile`이 universe로 필터). 유니버스에 없는 보유 종목은 매도 대상이
   아니며 NAV(관리 자산)에서도 제외한다.
2. **통화 = USD 단일** ✅ — 미국 주식만, KRW 환산·환손익 추적 없음.

**아직 미정(나중에 — 현재는 API 키 없이 프로그램 골격만 구축):**

3. **과거 캔들 깊이** — 토스 `/candles`의 히스토리 깊이가 백테스트(수년치)에
   충분한가? 부족하면 외부 소스(yfinance 등)로 백테스트 데이터를 보강하고,
   토스는 실거래 시세·체결에만 쓰는 분리 전략. (API 키 확보 후 확인)
4. **비용모델 시장 분리** — 7절. US 기준으로 우선 구현, KR은 골격만.

## 7. 비용 모델 — US/KR 분리 (interfaces.md 보강)

interfaces.md의 `Broker`는 한국 주식 기준(매도세 0.18%)이다. **미국 주식은
비용 구조가 다르다.** 시장별 설정으로 분리하고, 실제 값은 `GET /commissions`로
캘리브레이션한다.

| 항목 | 한국(KRX) | 미국(US) |
|------|-----------|----------|
| 수수료 | commissionRate | commissionRate |
| 매도세 | **0.18%(매도만)** | **없음** |
| 기타 | — | SEC/TAF fee류(매도, 소액) |
| 환전 | — | **FX 스프레드(매수·매도 환전)** |
| 슬리피지 | slippageRate | slippageRate |

```typescript
// engine/broker.ts (확장 방향)
export interface BrokerConfig {
  market: "KR" | "US";
  commissionRate: number;
  taxRate: number;        // KR 매도세. US는 0
  feeRate: number;        // US SEC/TAF 등. KR은 0
  fxSpread: number;       // US 환전 스프레드. KR은 0
  slippageRate: number;
}
```

> 백테스트 비용을 실거래와 맞추는 게 검증의 핵심(validation.md 4번).
> 추측하지 말고 `/commissions` 실측값으로 채운다.

## 8. 실거래 안전장치 (LIVE_SMALL/LIVE 전용)

샌드박스가 없으므로 가드를 코드로 강제한다.

- **킬 스위치** — 한 플래그로 전 주문 즉시 중단(DRY_RUN으로 강등).
- **주문 한도** — 1회/일일 최대 주문 금액·건수 캡. `LIVE_SMALL`은 작게.
- **고액주문 플래그** — 1천만원 초과 시 토스 `confirmHighValueOrder` 처리.
- **멱등성(idempotency)** — 재시도/네트워크 오류로 **중복 주문**이 나가지 않게
  주문에 클라이언트 측 식별자 부여, 제출 전 미체결 주문 조회로 대조.
- **사전 sanity 체크** — 제출 직전: 주문가가 현재가에서 비정상 이탈(예: ±X%)이
  아닌지, 매도수량 ≤ 보유수량, 매수금액 ≤ buying-power.
- **장중 시간/휴장 가드** — 거래 캘린더로 휴장·시간외 주문 차단.

## 9. 검증 연계 (validation.md 5번 관문 재정의)

페이퍼트레이딩 환경이 없으므로 관문을 모드 승급으로 재정의:
```
BACKTEST(비용 반영) → DRY_RUN(실데이터·무위험 파이프라인 검증)
   → LIVE_SMALL(소액, 백테스트-실거래 일치도 측정) → LIVE(점진 증액)
```
각 단계에서 **백테스트 성과 ≈ 실거래 성과**(라이브-백테스트 일치도)를 확인하며
다음 단계로만 승급한다. 불일치가 크면 비용모델·슬리피지·체결 가정 재점검.

## 10. 다음 단계로의 계약

- 전략 스택의 최종 산출 `target`(meta.weights × aggressiveness)을 `reconcile`이
  받아 `Order[]` 생성 → `OrderExecutor.submit`.
- 전략·메타·국면 레이어는 `AccountState`/토스를 **모른다**. 계좌·실행은
  엔진/실행 레이어에 격리. 브로커를 바꿔도 전략은 안 깨진다(모듈화 원칙).
```
