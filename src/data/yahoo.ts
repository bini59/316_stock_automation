/**
 * Yahoo Finance 차트 API 로더 (TODO 3.1 보강, API 키 불필요).
 *
 * 무료·키 불필요 과거 OHLCV 소스. 토스 /candles 깊이가 부족할 때 백테스트를
 * 외부 소스로 보강하는 전략(execution-and-data.md 6절)의 구현체 하나.
 * BarLoader 인터페이스를 따르므로 CSV 로더와 동일하게 loadDataset에 끼운다.
 *
 * 주의: 실거래 시세가 아니라 백테스트용 과거 데이터 전용. 실거래 시세는 토스.
 */
import type { Bar, PriceSeries } from "../types/market";
import type { BarLoader } from "./loader";
import { normalizeSeries } from "./integrity";

/** 테스트를 위해 fetch를 주입 가능하게 한다. 기본은 전역 fetch(Node 20+). */
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface YahooLoaderConfig {
  /** 시작 시점(epoch ms) */
  from: number;
  /** 종료 시점(epoch ms) */
  to: number;
  /** 주입식 fetch(테스트용). 기본 전역 fetch */
  fetchFn?: FetchLike;
  /** 차트 간격. 기본 1d */
  interval?: "1d" | "1wk" | "1mo";
}

interface YahooQuote {
  open: (number | null)[];
  high: (number | null)[];
  low: (number | null)[];
  close: (number | null)[];
  volume: (number | null)[];
}
interface YahooResult {
  timestamp?: number[];
  indicators?: { quote?: YahooQuote[] };
}
interface YahooChart {
  chart?: { result?: YahooResult[]; error?: unknown };
}

export class YahooBarLoader implements BarLoader {
  private readonly cfg: Required<Omit<YahooLoaderConfig, "fetchFn">> & { fetchFn: FetchLike };

  constructor(cfg: YahooLoaderConfig) {
    const fetchFn = cfg.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
    if (!fetchFn) throw new Error("YahooBarLoader: fetch를 사용할 수 없음(Node 18+ 또는 fetchFn 주입 필요)");
    this.cfg = {
      from: cfg.from,
      to: cfg.to,
      interval: cfg.interval ?? "1d",
      fetchFn,
    };
  }

  async load(symbol: string): Promise<PriceSeries> {
    const p1 = Math.floor(this.cfg.from / 1000);
    const p2 = Math.floor(this.cfg.to / 1000);
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?period1=${p1}&period2=${p2}&interval=${this.cfg.interval}`;

    const res = await this.cfg.fetchFn(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) {
      throw new Error(`YahooBarLoader: ${symbol} HTTP ${res.status}`);
    }
    const body = (await res.json()) as YahooChart;
    const result = body.chart?.result?.[0];
    if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
      throw new Error(`YahooBarLoader: ${symbol} 응답에 데이터 없음`);
    }
    return normalizeSeries(parseYahoo(result.timestamp, result.indicators.quote[0]));
  }
}

const DAY_MS = 86_400_000;

/**
 * Yahoo 차트 result → Bar[] (null 행 제외).
 *
 * ★ 일봉 타임스탬프를 UTC 자정으로 정규화한다. Yahoo는 심볼/거래소마다
 * 장중 타임스탬프(개장 시각)가 달라(특히 ^VIX 지수 vs ETF), 그대로 두면
 * alignUniverse의 정확-타임스탬프 교집합이 비어 유니버스가 통째로 사라진다.
 * 같은 날짜 = 같은 키가 되도록 날짜 단위로 맞춘다.
 */
export function parseYahoo(timestamps: readonly number[], q: YahooQuote): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = q.close[i];
    if (close == null || !Number.isFinite(close)) continue; // 휴장·결측 행 제외
    const open = q.open[i] ?? close;
    const high = q.high[i] ?? close;
    const low = q.low[i] ?? close;
    const volume = q.volume[i] ?? 0;
    const ts = timestamps[i];
    if (ts === undefined) continue;
    const dayMs = Math.floor((ts * 1000) / DAY_MS) * DAY_MS;
    bars.push({ timestamp: dayMs, open, high, low, close, volume });
  }
  return bars;
}
