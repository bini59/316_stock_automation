/**
 * 시뮬레이션 시세 소스 (MarketDataSource 구현체).
 *
 * look-ahead 차단(절대 원칙 1): candles(from,to)는 [from,to] 범위만,
 * currentPrice는 "현재 시점(now)까지"의 마지막 바만 노출한다. 미래 바는
 * 주입식 시계(clock)보다 뒤이면 반환하지 않는다.
 */
import type { MarketDataSource } from "../../types/broker-port";
import type { PriceSeries, Bar } from "../../types/market";

export interface SimulatedMarketDataInit {
  /** 심볼→전체 바 시계열(오름차순). 시뮬레이터가 시점으로 슬라이스한다 */
  readonly series: Readonly<Record<string, PriceSeries>>;
}

export class SimulatedMarketData implements MarketDataSource {
  private readonly series: Readonly<Record<string, PriceSeries>>;
  private readonly clock: () => number;

  constructor(init: SimulatedMarketDataInit, clock: () => number = () => Date.now()) {
    this.series = init.series;
    this.clock = clock;
  }

  async candles(symbol: string, from: number, to: number): Promise<PriceSeries> {
    const all = this.series[symbol] ?? [];
    const now = this.clock();
    // look-ahead 차단: 현재 시점(now) 이후 바는 절대 노출하지 않는다.
    const ceiling = Math.min(to, now);
    return all.filter((b) => b.timestamp >= from && b.timestamp <= ceiling);
  }

  async currentPrice(symbol: string): Promise<number> {
    const bar = this.lastBarUpTo(symbol, this.clock());
    if (bar === undefined) {
      throw new Error(`SimulatedMarketData: no price for ${symbol} as of now`);
    }
    return bar.close;
  }

  /** 현재 시점까지의 마지막 바 (없으면 undefined) */
  private lastBarUpTo(symbol: string, now: number): Bar | undefined {
    const all = this.series[symbol] ?? [];
    let last: Bar | undefined;
    for (const b of all) {
      if (b.timestamp > now) break;
      last = b;
    }
    return last;
  }
}
