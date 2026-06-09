/**
 * 포트폴리오 추적 (TODO 2.2). 다중 종목 포지션·현금·평가액.
 *
 * 불변 패턴(coding-style): 모든 변경은 새 상태를 반환하고 입력을 변이하지 않는다.
 * NAV = 현금 + 유니버스 보유 평가액 (account.ts 정의와 일치).
 */

export interface Position {
  readonly quantity: number;
  /** 평균 매입가 (체결가 기준) */
  readonly avgPrice: number;
}

export interface PortfolioState {
  readonly cash: number;
  readonly positions: Readonly<Record<string, Position>>;
}

export function emptyPortfolio(cash: number): PortfolioState {
  return { cash, positions: {} };
}

/**
 * 매수 체결 반영(불변). cash -= qty×fillPrice + cost. 평균단가 갱신.
 */
export function applyBuy(
  state: PortfolioState,
  symbol: string,
  qty: number,
  fillPrice: number,
  cost: number,
): PortfolioState {
  if (qty <= 0) return state;
  const prev = state.positions[symbol];
  const prevQty = prev?.quantity ?? 0;
  const prevAvg = prev?.avgPrice ?? 0;
  const newQty = prevQty + qty;
  const newAvg = newQty > 0 ? (prevQty * prevAvg + qty * fillPrice) / newQty : 0;
  return {
    cash: state.cash - qty * fillPrice - cost,
    positions: { ...state.positions, [symbol]: { quantity: newQty, avgPrice: newAvg } },
  };
}

/**
 * 매도 체결 반영(불변). cash += qty×fillPrice − cost. 보유량 초과 매도 방지.
 * 평균단가는 유지(부분 매도), 전량 매도 시 포지션 제거.
 */
export function applySell(
  state: PortfolioState,
  symbol: string,
  qty: number,
  fillPrice: number,
  cost: number,
): PortfolioState {
  const prev = state.positions[symbol];
  if (!prev || qty <= 0) return state;
  const sellQty = Math.min(qty, prev.quantity);
  const remaining = prev.quantity - sellQty;
  const positions = { ...state.positions };
  if (remaining <= 1e-12) {
    delete positions[symbol];
  } else {
    positions[symbol] = { quantity: remaining, avgPrice: prev.avgPrice };
  }
  return { cash: state.cash + sellQty * fillPrice - cost, positions };
}

/** 보유 종목 평가액 합 (universe 지정 시 그 안만). prices: 심볼→현재가 */
export function holdingsValue(
  state: PortfolioState,
  prices: Readonly<Record<string, number>>,
  universe?: ReadonlySet<string>,
): number {
  let sum = 0;
  for (const [sym, pos] of Object.entries(state.positions)) {
    if (universe && !universe.has(sym)) continue;
    const px = prices[sym];
    if (px === undefined) continue;
    sum += pos.quantity * px;
  }
  return sum;
}

/** NAV = 현금 + 유니버스 보유 평가액 */
export function nav(
  state: PortfolioState,
  prices: Readonly<Record<string, number>>,
  universe?: ReadonlySet<string>,
): number {
  return state.cash + holdingsValue(state, prices, universe);
}
