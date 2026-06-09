/** 백테스트 결과·지표 타입. pnl·equityCurve는 모두 거래비용 차감 후 값. */

export interface Trade {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  /** 거래비용(수수료·세금·슬리피지·fx) 차감 후 손익 */
  pnl: number;
}

export interface Metrics {
  totalReturn: number;
  /** 연율화 샤프 비율 */
  sharpe: number;
  /** 최대 낙폭 0..1 (예: 0.32 = -32%) */
  maxDrawdown: number;
  winRate: number;
  tradeCount: number;
}

export interface BacktestResult {
  /** 시점별 평가자산(현금 + 보유 평가액), 비용 반영 후 */
  equityCurve: number[];
  trades: Trade[];
  metrics: Metrics;
}
