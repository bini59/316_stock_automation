/**
 * 데이터 정합 검사·정규화 (TODO 3.3).
 *
 * 데이터 품질이 나쁘면 위층이 전부 무너진다(garbage in, garbage out).
 * 결측·중복 타임스탬프·역순·OHLC 모순을 잡아낸다. 다중종목 백테스터는
 * 인덱스 정렬을 가정하므로 alignUniverse로 공통 타임라인에 맞춘다.
 */
import type { Bar, PriceSeries } from "../types/market";
import type { UniverseHistory } from "../types/strategy";

export interface ValidationIssue {
  index: number;
  timestamp: number;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
}

/** OHLCV 정합 + 시간 오름차순 + 중복 없음 검증 */
export function validateSeries(series: PriceSeries): ValidationReport {
  const issues: ValidationIssue[] = [];
  let prevTs = -Infinity;
  for (let i = 0; i < series.length; i++) {
    const b = series[i];
    if (b === undefined) continue;
    const at = (msg: string) => issues.push({ index: i, timestamp: b.timestamp, message: msg });

    if (!Number.isFinite(b.timestamp)) at("timestamp가 유한수가 아님");
    if (b.timestamp === prevTs) at("중복 타임스탬프");
    if (b.timestamp < prevTs) at("시간 역순(정렬 안 됨)");

    for (const [k, v] of [
      ["open", b.open],
      ["high", b.high],
      ["low", b.low],
      ["close", b.close],
    ] as const) {
      if (!Number.isFinite(v)) at(`${k}가 유한수가 아님`);
      if (v <= 0) at(`${k}가 양수가 아님(${v})`);
    }
    if (!Number.isFinite(b.volume) || b.volume < 0) at(`volume 비정상(${b.volume})`);
    if (b.high < b.low) at("high < low");
    if (b.high < b.open || b.high < b.close) at("high가 open/close보다 작음");
    if (b.low > b.open || b.low > b.close) at("low가 open/close보다 큼");

    prevTs = b.timestamp;
  }
  return { ok: issues.length === 0, issues };
}

/**
 * 정규화: 시간 오름차순 정렬 + 중복 타임스탬프 제거(나중 값 우선).
 * 입력 불변 — 새 배열 반환.
 */
export function normalizeSeries(series: PriceSeries): Bar[] {
  const byTs = new Map<number, Bar>();
  for (const b of series) byTs.set(b.timestamp, b);
  return [...byTs.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * 유니버스를 공통 타임스탬프(모든 심볼에 존재하는 시점)로 정렬.
 * 결과의 각 series는 동일 길이·동일 인덱스 → backtestPortfolio가 안전하게 소비.
 */
export function alignUniverse(universe: UniverseHistory): UniverseHistory {
  const symbols = Object.keys(universe);
  if (symbols.length === 0) return {};

  const tsSets = symbols.map((s) => new Set((universe[s] ?? []).map((b) => b.timestamp)));
  const first = tsSets[0]!;
  const common = [...first].filter((ts) => tsSets.every((set) => set.has(ts))).sort((a, b) => a - b);
  const commonSet = new Set(common);

  const out: Record<string, PriceSeries> = {};
  for (const s of symbols) {
    const map = new Map((universe[s] ?? []).map((b) => [b.timestamp, b] as const));
    out[s] = common.filter((ts) => commonSet.has(ts)).map((ts) => map.get(ts)!);
  }
  return out;
}
