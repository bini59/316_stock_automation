/**
 * 계좌 상태 타입 (docs/coding/execution-and-data.md 2절).
 *
 * 통화 = USD 단일. NAV = 현금 + 유니버스 보유 평가액(= 관리 자산).
 * 유니버스 밖 보유는 NAV에서 제외하고 건드리지 않는다.
 */

export interface Holding {
  symbol: string;
  quantity: number;
  /** 평균 매입가 (해당 종목 통화) */
  avgPrice: number;
  /** 현재 평가액 (계좌 기준통화로 환산) */
  marketValue: number;
  currency: string;
}

export interface AccountState {
  accountSeq: string;
  /** USD 단일 통화로 운용 (결정) */
  baseCurrency: "USD";
  /** 가용 현금 (USD) */
  cash: number;
  holdings: Readonly<Record<string, Holding>>;
  /** 관리 순자산 = 현금 + 유니버스 보유 평가액 */
  nav: number;
  /** 조회 시점 */
  asOf: number;
}
