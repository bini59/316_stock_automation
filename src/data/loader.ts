/**
 * 데이터 적재 (TODO 3.1). OHLCV 소스 추상화(CSV / 외부 API / 메모리).
 *
 * API 키 없이 동작: CSV 파일 또는 메모리 배열에서 과거 데이터를 적재한다.
 * 토스 /candles 깊이가 부족하면 외부 소스(yfinance 등)로 백테스트를 보강하고
 * 토스는 실거래 시세 전용으로 분리(execution-and-data.md 6절). 그 보강 소스가
 * 이 BarLoader 인터페이스의 또 다른 구현체가 된다.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Bar, PriceSeries } from "../types/market";
import type { UniverseHistory } from "../types/strategy";
import type { MacroContext } from "../types/regime";
import { normalizeSeries, validateSeries, alignUniverse } from "./integrity";

/** 심볼의 가용 전체 히스토리를 적재하는 추상 인터페이스 */
export interface BarLoader {
  load(symbol: string): Promise<PriceSeries>;
}

/** 테스트·메모리용 로더 */
export class InMemoryBarLoader implements BarLoader {
  constructor(private readonly data: Readonly<Record<string, PriceSeries>>) {}
  async load(symbol: string): Promise<PriceSeries> {
    const s = this.data[symbol];
    if (!s) throw new Error(`InMemoryBarLoader: 심볼 없음 ${symbol}`);
    return normalizeSeries(s);
  }
}

/**
 * CSV 로더. 파일 경로: {dir}/{symbol}.csv
 * 헤더: date(또는 timestamp),open,high,low,close,volume
 * date는 ISO 문자열 또는 epoch(ms/s) 허용.
 */
export class CsvBarLoader implements BarLoader {
  constructor(private readonly dir: string) {}

  async load(symbol: string): Promise<PriceSeries> {
    const file = path.join(this.dir, `${symbol}.csv`);
    const text = await readFile(file, "utf8");
    return normalizeSeries(parseCsv(text));
  }
}

/** CSV 텍스트 → Bar[] (의존성 없는 최소 파서) */
export function parseCsv(text: string): Bar[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const tsCol = idx("timestamp") >= 0 ? idx("timestamp") : idx("date");
  const oCol = idx("open");
  const hCol = idx("high");
  const lCol = idx("low");
  const cCol = idx("close");
  const vCol = idx("volume");
  if ([tsCol, oCol, hCol, lCol, cCol].some((i) => i < 0)) {
    throw new Error(`parseCsv: 헤더에 date/open/high/low/close 누락 (${header.join(",")})`);
  }

  const bars: Bar[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(",");
    const ts = parseTimestamp(cols[tsCol]?.trim() ?? "");
    if (ts === null) continue;
    bars.push({
      timestamp: ts,
      open: Number(cols[oCol]),
      high: Number(cols[hCol]),
      low: Number(cols[lCol]),
      close: Number(cols[cCol]),
      volume: vCol >= 0 ? Number(cols[vCol]) : 0,
    });
  }
  return bars;
}

/** ISO 날짜 또는 epoch(s/ms) → epoch ms */
export function parseTimestamp(raw: string): number | null {
  if (raw === "") return null;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    // 10자리면 초, 13자리면 ms로 추정
    return raw.length <= 10 ? n * 1000 : n;
  }
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

export interface DatasetSpec {
  /** 기준 지수 (^GSPC 또는 SPY) */
  benchmark: string;
  /** 운용 유니버스 심볼 */
  universe: readonly string[];
  /** 보조 시계열 (^VIX, ^VIX3M) */
  vix?: string;
  vix3m?: string;
}

export interface Dataset {
  benchmark: PriceSeries;
  /** 공통 타임라인으로 정렬된 유니버스 */
  universe: UniverseHistory;
  macro: MacroContext;
}

/**
 * 데이터셋 적재 + 정합 검사 + 유니버스 정렬.
 * @throws 정합 검사 실패(결측·역순·OHLC 모순) 시
 */
export async function loadDataset(loader: BarLoader, spec: DatasetSpec): Promise<Dataset> {
  const benchmark = await loadValidated(loader, spec.benchmark);

  const rawUniverse: Record<string, PriceSeries> = {};
  for (const sym of spec.universe) {
    rawUniverse[sym] = await loadValidated(loader, sym);
  }
  const universe = alignUniverse(rawUniverse);

  const macro: MacroContext = {};
  if (spec.vix) macro.vix = await loadValidated(loader, spec.vix);
  if (spec.vix3m) macro.vix3m = await loadValidated(loader, spec.vix3m);

  return { benchmark, universe, macro };
}

async function loadValidated(loader: BarLoader, symbol: string): Promise<PriceSeries> {
  const series = await loader.load(symbol);
  const report = validateSeries(series);
  if (!report.ok) {
    const first = report.issues[0];
    throw new Error(
      `데이터 정합 실패 ${symbol}: ${report.issues.length}건 (예: idx ${first?.index} ${first?.message})`,
    );
  }
  return series;
}
