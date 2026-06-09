/**
 * 거래비용 모델 (docs/coding/interfaces.md + execution-and-data.md 7절).
 *
 * 비용을 Broker로 분리해 "거래비용 누락"을 구조적으로 막는다(절대 원칙 2).
 * 백테스터가 체결할 때 반드시 이걸 거치므로 비용 0 백테스트가 불가능해진다.
 *
 * 시장별 분리(KR/US):
 * - KR: 매도세(taxRate, 매도만), fee/fx 없음
 * - US: 매도세 없음, SEC/TAF fee류(매도 소액), FX 환전 스프레드(매수·매도)
 *
 * 실제 값은 토스 GET /commissions 실측으로 캘리브레이션(추측 금지) — Phase 7.
 */

export type Market = "KR" | "US";

export interface BrokerConfig {
  market: Market;
  /** 수수료율 (매수·매도 공통) */
  commissionRate: number;
  /** 매도세. KR 매도만, US는 0 */
  taxRate: number;
  /** SEC/TAF 등 매도 fee. US 매도, KR은 0 */
  feeRate: number;
  /** 환전 스프레드. US 매수·매도, KR은 0 */
  fxSpread: number;
  /** 체결 오차 */
  slippageRate: number;
}

/**
 * 미국 주식 기본 프로필. 보수적 추정값(캘리브레이션 전 placeholder).
 * - commission: 토스 미국주식 수수료 가정(실측 전)
 * - tax: 0 (미국 매도세 없음)
 * - fee: SEC fee + TAF 합산 근사(매도, 소액)
 * - fxSpread: 환전 스프레드(편도) 근사
 */
export function usBrokerConfig(overrides: Partial<BrokerConfig> = {}): BrokerConfig {
  return {
    market: "US",
    commissionRate: 0.0007,
    taxRate: 0,
    feeRate: 0.0000278,
    fxSpread: 0.001,
    slippageRate: 0.001,
    ...overrides,
  };
}

/** 한국 주식 골격 프로필(매도세 0.18%). 미국 운용이 기본이라 골격만 유지. */
export function krBrokerConfig(overrides: Partial<BrokerConfig> = {}): BrokerConfig {
  return {
    market: "KR",
    commissionRate: 0.00015,
    taxRate: 0.0018,
    feeRate: 0,
    fxSpread: 0,
    slippageRate: 0.001,
    ...overrides,
  };
}

export class Broker {
  constructor(private readonly cfg: BrokerConfig) {}

  get config(): Readonly<BrokerConfig> {
    return this.cfg;
  }

  /** 매수 체결가: 슬리피지로 약간 불리하게(비싸게) */
  fillBuy(price: number): number {
    return price * (1 + this.cfg.slippageRate);
  }

  /** 매도 체결가: 슬리피지로 약간 불리하게(싸게) */
  fillSell(price: number): number {
    return price * (1 - this.cfg.slippageRate);
  }

  /**
   * 거래당 비용 (항상 양수로 빠져나감).
   * 수수료(양방향) + 매도세(KR 매도) + fee(US 매도) + FX 스프레드(US 양방향).
   */
  cost(side: "BUY" | "SELL", notional: number): number {
    const n = Math.abs(notional);
    const commission = n * this.cfg.commissionRate;
    const tax = side === "SELL" ? n * this.cfg.taxRate : 0;
    const fee = side === "SELL" ? n * this.cfg.feeRate : 0;
    const fx = n * this.cfg.fxSpread;
    return commission + tax + fee + fx;
  }
}
