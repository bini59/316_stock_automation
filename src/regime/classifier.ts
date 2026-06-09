/**
 * RuleBasedRegimeClassifier (docs/strategy/regime.md).
 *
 * classify(history, ctx?)는 순수·무상태다 — 같은 입력이면 항상 같은 출력.
 * 하드 라벨은 history 내부에서 멤버십 경로를 처음부터 walk하며 슈미트+체류로
 * 매 호출 재계산한다(호출 간 가변 상태 없음). 모든 통계는 trailing.
 */
import type { PriceSeries } from "../types/market";
import type {
  MacroContext,
  RegimeClassifier,
  RegimeLabel,
  RegimeState,
} from "../types/regime";
import {
  closesOf,
  emaSeries,
  realizedVol,
  rollingPercentile,
  zScore,
  kaufmanER,
  smaSlope,
  distanceFromSma,
} from "../indicators";
import {
  computeTrend,
  computeVolatility,
  computeMembership,
  computeConfidence,
  type MembershipParams,
  type RegimeAxes,
} from "./membership";
import { termStress } from "./signals";
import { deriveHardLabel, type HysteresisParams } from "./hysteresis";

/** 분류기 전체 파라미터 (regime.md 7절 기본값). */
export interface RegimeClassifierParams
  extends MembershipParams,
    HysteresisParams {
  smaWindow: number;
  slopeLookback: number;
  erWindow: number;
  rvWindow: number;
  pctLookback: number;
  /** 입력 EMA span(평활) */
  emaSpan: number;
}

export const DEFAULT_REGIME_PARAMS: RegimeClassifierParams = {
  smaWindow: 200,
  slopeLookback: 20,
  erWindow: 30,
  rvWindow: 20,
  pctLookback: 378,
  wD: 0.6,
  wS: 0.4,
  kT: 0.8,
  crisisC: 0.8,
  crisisS: 0.06,
  emaSpan: 7,
  enter: 0.5,
  exit: 0.4,
  dwellK: 3,
};

/** 데이터 부족 시의 중립 상태(membership 합=1, chop 우세). */
function neutralState(asOf: number): RegimeState {
  return {
    asOf,
    trend: 0,
    volatility: 0,
    trendQuality: 0,
    membership: { bull: 0, bear: 0, chop: 1, crisis: 0 },
    label: "chop",
    confidence: 1,
  };
}

/**
 * 각 시점의 rv20 시계열(causal). 인덱스는 closes 인덱스와 정렬되며,
 * rv가 정의되는 첫 시점 이전은 undefined.
 */
function buildRvSeries(closes: readonly number[], rvWindow: number): Array<number | undefined> {
  const out: Array<number | undefined> = new Array(closes.length).fill(undefined);
  for (let j = 0; j < closes.length; j++) {
    out[j] = realizedVol(closes.slice(0, j + 1), rvWindow);
  }
  return out;
}

/** trailing 백분위(미래 미참조): 시점 i에서 vals[0..i]의 마지막 window 분위. */
function trailingPercentileAt(
  vals: ReadonlyArray<number | undefined>,
  i: number,
  window: number,
): number | undefined {
  const defined: number[] = [];
  for (let j = 0; j <= i; j++) {
    const v = vals[j];
    if (v !== undefined) defined.push(v);
  }
  if (defined.length < 2) return undefined;
  const w = Math.min(window, defined.length);
  return rollingPercentile(defined, w);
}

/** trailing z(미래 미참조): 시점 i에서 vals[0..i]의 마지막 window z. */
function trailingZAt(
  vals: ReadonlyArray<number | undefined>,
  i: number,
  window: number,
): number | undefined {
  const defined: number[] = [];
  for (let j = 0; j <= i; j++) {
    const v = vals[j];
    if (v !== undefined) defined.push(v);
  }
  if (defined.length < 2) return undefined;
  const w = Math.min(window, defined.length);
  return zScore(defined, w);
}

/**
 * history(+ctx)에서 각 시점의 원시 축(trend·volatility·trendQuality) 시계열을
 * 만든다. 전부 trailing — 시점 i는 history[0..i]만 본다.
 */
function buildRawAxisSeries(
  closes: readonly number[],
  ctx: MacroContext | undefined,
  params: RegimeClassifierParams,
): RegimeAxes[] {
  const n = closes.length;

  // 원시 신호 시계열(각 시점은 그 시점까지만 사용).
  const d200: Array<number | undefined> = new Array(n).fill(undefined);
  const slope200: Array<number | undefined> = new Array(n).fill(undefined);
  const erSeries: Array<number | undefined> = new Array(n).fill(undefined);
  for (let i = 0; i < n; i++) {
    const prefix = closes.slice(0, i + 1);
    d200[i] = distanceFromSma(prefix, params.smaWindow);
    slope200[i] = smaSlope(prefix, params.smaWindow, params.slopeLookback);
    erSeries[i] = kaufmanER(prefix, params.erWindow);
  }
  const rvSeries = buildRvSeries(closes, params.rvWindow);

  // ctx 시계열(현재 시점까지로 정렬되어 들어온다). VIX는 history와 길이가
  // 다를 수 있으므로 끝(최근)을 기준으로 정렬한다. 인덱스 i의 ctx 슬라이스는
  // ctx의 "최근 (n-i) 바를 제외한" prefix가 아니라, 같은 캘린더 끝점 정렬을
  // 가정한다(loader가 보장). 정렬 가정이 깨지면 vix 길이를 history에 맞춰 자른다.
  const vixCloses = ctx?.vix ? closesOf(ctx.vix) : undefined;

  const axes: RegimeAxes[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const zD = trailingZAt(d200, i, params.pctLookback);
    const zS = trailingZAt(slope200, i, params.pctLookback);
    const trend = computeTrend(zD, zS, params);

    const rvPct = trailingPercentileAt(rvSeries, i, params.pctLookback);

    // vix prefix: history 끝과 정렬되었다고 보고, history 인덱스 i에 대응하는
    // vix prefix를 같은 끝점 오프셋으로 자른다. (i가 history 끝에서 n-1-i 만큼
    // 떨어졌다면 vix도 동일 오프셋만큼 잘라 그 시점까지만 본다.)
    let vixPct: number | undefined;
    let ts: number | undefined;
    if (vixCloses && ctx?.vix) {
      const off = n - 1 - i; // history 끝에서의 거리
      const vixEnd = ctx.vix.length - off; // i 시점에 대응하는 vix 끝(배타적 길이)
      if (vixEnd >= 2) {
        const vixPrefixCloses = vixCloses.slice(0, vixEnd);
        const w = Math.min(params.pctLookback, vixPrefixCloses.length);
        vixPct = rollingPercentile(vixPrefixCloses, w);
        const vixPrefix = ctx.vix.slice(0, vixEnd);
        const vix3mPrefix = ctx.vix3m
          ? ctx.vix3m.slice(0, ctx.vix3m.length - off)
          : undefined;
        ts =
          vix3mPrefix && vix3mPrefix.length > 0
            ? termStress(vixPrefix, vix3mPrefix)
            : undefined;
      }
    }

    const volatility = computeVolatility(rvPct, vixPct, ts);
    const er = erSeries[i];
    axes[i] = { trend, volatility, trendQuality: er ?? 0 };
  }

  return axes;
}

/** EMA 평활을 RegimeAxes 시계열에 적용(trend·volatility만 평활, ER은 원본). */
function smoothAxisSeries(raw: RegimeAxes[], span: number): RegimeAxes[] {
  if (raw.length === 0) return raw;
  const trendS = emaSeries(
    raw.map((a) => a.trend),
    span,
  );
  const volS = emaSeries(
    raw.map((a) => a.volatility),
    span,
  );
  return raw.map((a, i) => ({
    trend: trendS[i]!,
    volatility: volS[i]!,
    trendQuality: a.trendQuality,
  }));
}

export class RuleBasedRegimeClassifier implements RegimeClassifier {
  readonly name = "rule-based-regime";
  readonly params: Readonly<Record<string, number>>;
  private readonly p: RegimeClassifierParams;

  constructor(params: Partial<RegimeClassifierParams> = {}) {
    this.p = { ...DEFAULT_REGIME_PARAMS, ...params };
    this.params = { ...this.p };
  }

  classify(history: PriceSeries, ctx?: MacroContext): RegimeState {
    const asOf = history.length > 0 ? history[history.length - 1]!.timestamp : 0;
    if (history.length === 0) return neutralState(asOf);

    const closes = closesOf(history);

    // 1) 원시 축 시계열(전부 trailing) → 2) 입력 EMA 평활 → 3) 멤버십 시계열.
    const rawAxes = buildRawAxisSeries(closes, ctx, this.p);
    const smoothed = smoothAxisSeries(rawAxes, this.p.emaSpan);

    const membershipSeries: Array<Record<RegimeLabel, number>> = smoothed.map((a) =>
      computeMembership(a, this.p),
    );

    // 4) 하드 라벨: 멤버십 경로를 처음부터 walk(슈미트+체류). 무상태.
    const label = deriveHardLabel(membershipSeries, this.p);

    // 5) 현재(마지막) 시점 상태.
    const last = smoothed[smoothed.length - 1]!;
    const membership = membershipSeries[membershipSeries.length - 1]!;
    const confidence = computeConfidence(membership);

    return {
      asOf,
      trend: last.trend,
      volatility: last.volatility,
      trendQuality: last.trendQuality,
      membership,
      label,
      confidence,
    };
  }
}
