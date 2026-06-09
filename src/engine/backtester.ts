/**
 * 백테스터 루프 (TODO 2.5, docs/coding/interfaces.md 골격).
 *
 * look-ahead 1차 방어선: 매 시점 data.slice(0, i+1)로만 전략에 노출한다.
 * 비용 누락 차단: 모든 체결은 Broker를 거친다(비용 0 백테스트 불가).
 *
 * 단일종목 backtest + 다중종목 backtestPortfolio(target-weight, 파이프라인 통합용).
 */
import type { PriceSeries } from "../types/market";
import type { Strategy, UniverseHistory } from "../types/strategy";
import type { BacktestResult, Trade } from "../types/result";
import { Broker } from "./broker";
import { computeMetrics } from "../validation/metrics";
import {
  emptyPortfolio,
  applyBuy,
  applySell,
  nav,
  type PortfolioState,
} from "./portfolio";

/** 단일종목 백테스트. 신호 BUY/SELL/HOLD를 비용 반영해 체결. */
export function backtest(
  strategy: Strategy,
  data: PriceSeries,
  broker: Broker,
  initialCapital: number,
): BacktestResult {
  let cash = initialCapital;
  let position = 0;
  let entryPrice = 0;
  let entryTime = 0;
  const equityCurve: number[] = [];
  const trades: Trade[] = [];

  for (let i = 0; i < data.length; i++) {
    // 현재 시점까지만 전략에 노출 → 미래 차단
    const history = data.slice(0, i + 1);
    const signal = strategy.next(history);
    const bar = data[i];
    if (bar === undefined) continue;

    if (signal.action === "BUY" && position === 0 && signal.strength > 0) {
      const fillPrice = broker.fillBuy(bar.close);
      const notional = cash * Math.min(1, signal.strength);
      const qty = notional / fillPrice;
      cash -= notional + broker.cost("BUY", notional);
      position = qty;
      entryPrice = fillPrice;
      entryTime = bar.timestamp;
    } else if (signal.action === "SELL" && position > 0) {
      const fillPrice = broker.fillSell(bar.close);
      const notional = position * fillPrice;
      const sellCost = broker.cost("SELL", notional);
      cash += notional - sellCost;
      trades.push({
        entryTime,
        exitTime: bar.timestamp,
        entryPrice,
        exitPrice: fillPrice,
        // 비용 차감 후 손익 (매수 슬리피지는 entryPrice에 이미 반영)
        pnl: position * (fillPrice - entryPrice) - sellCost,
      });
      position = 0;
    }

    equityCurve.push(cash + position * bar.close);
  }

  return { equityCurve, trades, metrics: computeMetrics(equityCurve, trades) };
}

/** 리밸런스 시점의 포트폴리오 컨텍스트(낙폭 브레이크 등 적극도 입력용) */
export interface RebalanceContext {
  /** 현재 NAV(체결 전) */
  equity: number;
  /** 현재 낙폭 0..1 (러닝 피크 대비) — sentiment ddBrake 입력 */
  drawdown: number;
}

/** 다중종목 백테스터 입력. universe의 모든 series는 동일 타임라인(인덱스 정렬). */
export interface PortfolioBacktestInput {
  universe: UniverseHistory;
  broker: Broker;
  initialCapital: number;
  /**
   * 목표비중 산출. histories는 "현재 시점까지" 슬라이스(look-ahead 차단),
   * i는 현재 바 인덱스, ctx는 현재 포트폴리오 상태(equity/drawdown).
   * 합 ≤ 1 (나머지는 현금). 파이프라인이 전략 스택을 주입.
   */
  targetWeights: (
    histories: UniverseHistory,
    i: number,
    ctx: RebalanceContext,
  ) => Readonly<Record<string, number>>;
  /** 리밸런싱 주기(바 단위). 예: 5 = 주간(영업일). 기본 1 */
  rebalanceEvery?: number;
  /** 무거래 밴드(절대 금액): 이 금액 미만 델타는 무시(churn 방지). 기본 0 */
  minTradeNotional?: number;
  /**
   * 무거래 밴드(NAV 비례): 매 리밸런스에서 equity×이 비율 미만 델타는 무시.
   * 가격 드리프트로 인한 미세 churn(비용 누수)을 막는다. 기본 0.005(0.5%).
   * 실효 밴드 = max(minTradeNotional, minTradeFraction×equity).
   */
  minTradeFraction?: number;
}

/** 공통 타임라인 길이(가장 짧은 series 기준으로 안전하게) */
function timelineLength(universe: UniverseHistory): number {
  const lengths = Object.values(universe).map((s) => s.length);
  return lengths.length === 0 ? 0 : Math.min(...lengths);
}

/** i 시점까지의 universe 슬라이스(look-ahead 차단) */
function sliceUniverse(universe: UniverseHistory, i: number): UniverseHistory {
  const out: Record<string, PriceSeries> = {};
  for (const [sym, series] of Object.entries(universe)) {
    out[sym] = series.slice(0, i + 1);
  }
  return out;
}

/** i 시점 종가 맵 */
function pricesAt(universe: UniverseHistory, i: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [sym, series] of Object.entries(universe)) {
    const bar = series[i];
    if (bar !== undefined) out[sym] = bar.close;
  }
  return out;
}

/**
 * 다중종목 백테스터. target-weight를 받아 리밸런싱 주기에만 체결한다.
 * 모든 체결은 Broker를 거치고, 매도 시 실현손익을 Trade로 기록한다.
 */
export function backtestPortfolio(input: PortfolioBacktestInput): BacktestResult {
  const { universe, broker, initialCapital } = input;
  const rebalanceEvery = Math.max(1, input.rebalanceEvery ?? 1);
  const minTradeNotional = input.minTradeNotional ?? 0;
  const minTradeFraction = input.minTradeFraction ?? 0.005;

  const n = timelineLength(universe);
  let state: PortfolioState = emptyPortfolio(initialCapital);
  const entryTimes: Record<string, number> = {};
  const equityCurve: number[] = [];
  const trades: Trade[] = [];
  let peakEquity = -Infinity;

  for (let i = 0; i < n; i++) {
    const prices = pricesAt(universe, i);
    const ts = Object.values(universe)[0]?.[i]?.timestamp ?? i;

    const equity = nav(state, prices);
    if (equity > peakEquity) peakEquity = equity;
    const drawdown = peakEquity > 0 ? Math.min(1, Math.max(0, (peakEquity - equity) / peakEquity)) : 0;

    if (i % rebalanceEvery === 0) {
      const target = input.targetWeights(sliceUniverse(universe, i), i, { equity, drawdown });
      // 무거래 밴드: 가격 드리프트로 인한 미세 churn(비용 누수) 차단
      const band = Math.max(minTradeNotional, minTradeFraction * equity);

      const symbols = new Set<string>([
        ...Object.keys(target),
        ...Object.keys(state.positions),
      ]);

      // 매도 먼저(현금 확보) → 매수
      const deltas: { sym: string; delta: number; price: number }[] = [];
      for (const sym of symbols) {
        const price = prices[sym];
        if (price === undefined || price <= 0) continue;
        const targetValue = (target[sym] ?? 0) * equity;
        const currentValue = (state.positions[sym]?.quantity ?? 0) * price;
        const delta = targetValue - currentValue;
        if (Math.abs(delta) < band) continue;
        deltas.push({ sym, delta, price });
      }

      for (const { sym, delta, price } of deltas.filter((d) => d.delta < 0)) {
        const fillPrice = broker.fillSell(price);
        const sellQty = Math.min(state.positions[sym]?.quantity ?? 0, -delta / fillPrice);
        if (sellQty <= 0) continue;
        const proceeds = sellQty * fillPrice;
        const cost = broker.cost("SELL", proceeds);
        const avg = state.positions[sym]?.avgPrice ?? fillPrice;
        state = applySell(state, sym, sellQty, fillPrice, cost);
        trades.push({
          entryTime: entryTimes[sym] ?? ts,
          exitTime: ts,
          entryPrice: avg,
          exitPrice: fillPrice,
          pnl: sellQty * (fillPrice - avg) - cost,
        });
      }

      for (const { sym, delta, price } of deltas.filter((d) => d.delta > 0)) {
        const fillPrice = broker.fillBuy(price);
        const affordable = Math.max(0, state.cash);
        const spend = Math.min(delta, affordable / (1 + broker.config.commissionRate + broker.config.fxSpread));
        if (spend <= 0) continue;
        const qty = spend / fillPrice;
        state = applyBuy(state, sym, qty, fillPrice, broker.cost("BUY", spend));
        entryTimes[sym] = ts;
      }
    }

    equityCurve.push(nav(state, prices));
  }

  return { equityCurve, trades, metrics: computeMetrics(equityCurve, trades) };
}
