/**
 * 방어 패밀리 (TODO 4.2.4, docs/strategy/strategy-pool.md 5.3).
 *
 * 롱-온리이므로 "방어 = 공매도"가 아니라 덜 위험한 곳으로 + 현금↑.
 *   1) 저변동 틸트: 실현변동성 하위 분위에 비중 집중(역변동성 가중).
 *   2) 방어섹터 로테이션: DEFENSIVE_SECTORS(XLP/XLU/XLV) 중 유니버스에 있는 것만 보유.
 *   3) 현금 레이즈: weights 합을 grossCap으로 낮춰 현금 비중 확대.
 *
 * affinity: bear 1.0, crisis 0.4, chop 0.2.
 *
 * ★ look-ahead: realizedVol 등 trailing. 무상태·순수.
 */
import type {
  RegimeStrategy,
  UniverseHistory,
} from "../types/strategy";
import type { RegimeLabel, RegimeState } from "../types/regime";
import { closesOf, realizedVol } from "../indicators";
import { DEFENSIVE_SECTORS } from "../data/universe";
import { equalWeight, inverseVolWeight, capSum } from "./weights";

const DEFENSIVE_AFFINITY: Readonly<Partial<Record<RegimeLabel, number>>> = {
  bear: 1.0,
  crisis: 0.4,
  chop: 0.2,
};

/**
 * 저변동 틸트: 유니버스에서 실현변동성 하위 분위(bottomQuantile)만 골라
 * 역변동성 가중. 합을 grossCap으로 캡(현금 일부 보존).
 */
export class LowVolTilt implements RegimeStrategy {
  readonly name = "defensive-lowvol";
  readonly family = "defensive" as const;
  readonly regimeAffinity = DEFENSIVE_AFFINITY;
  readonly params: Readonly<Record<string, number>>;

  constructor(params: Partial<Record<string, number>> = {}) {
    this.params = {
      volWindow: 20,
      bottomQuantile: 0.5,
      grossCap: 0.6,
      ...params,
    };
  }

  propose(universe: UniverseHistory, _regime: RegimeState): Record<string, number> {
    const { volWindow, bottomQuantile, grossCap } = this.params;
    const scored: { symbol: string; vol: number }[] = [];
    for (const [symbol, series] of Object.entries(universe)) {
      const v = realizedVol(closesOf(series), volWindow!);
      if (v !== undefined && v > 0) scored.push({ symbol, vol: v });
    }
    if (scored.length === 0) return {};
    scored.sort((a, b) => a.vol - b.vol); // 낮은 변동성 우선
    const q = Math.min(1, Math.max(0.01, bottomQuantile!));
    const n = Math.max(1, Math.ceil(scored.length * q));
    const picked = scored.slice(0, n);
    const vols: Record<string, number> = {};
    for (const p of picked) vols[p.symbol] = p.vol;
    return inverseVolWeight(vols, Math.min(1, Math.max(0, grossCap!)));
  }
}

/**
 * 방어섹터 로테이션: DEFENSIVE_SECTORS 중 유니버스에 존재하는 것만 동일가중.
 * 합을 grossCap으로 캡. 유니버스에 방어섹터가 없으면 전량 현금({}).
 */
export class DefensiveSectorRotation implements RegimeStrategy {
  readonly name = "defensive-sector-rotation";
  readonly family = "defensive" as const;
  readonly regimeAffinity = DEFENSIVE_AFFINITY;
  readonly params: Readonly<Record<string, number>>;
  private readonly sectors: readonly string[];

  constructor(
    params: Partial<Record<string, number>> = {},
    sectors: readonly string[] = DEFENSIVE_SECTORS,
  ) {
    this.params = { grossCap: 0.6, ...params };
    this.sectors = sectors;
  }

  propose(universe: UniverseHistory, _regime: RegimeState): Record<string, number> {
    const { grossCap } = this.params;
    const present = this.sectors.filter((s) => Object.prototype.hasOwnProperty.call(universe, s));
    if (present.length === 0) return {};
    return equalWeight(present, Math.min(1, Math.max(0, grossCap!)));
  }
}

/**
 * 현금 레이즈: 기준 후보(전 유니버스 동일가중)를 받아 합을 grossCap으로 낮춰
 * 현금 비중을 확대. crisis로 갈수록(volatility 높을수록) grossCap을 더 줄인다.
 *
 * crisis 멤버십이 강하면 grossCap을 minGross까지 비례 축소(국면 반응).
 */
export class CashRaise implements RegimeStrategy {
  readonly name = "defensive-cash-raise";
  readonly family = "defensive" as const;
  readonly regimeAffinity = DEFENSIVE_AFFINITY;
  readonly params: Readonly<Record<string, number>>;

  constructor(params: Partial<Record<string, number>> = {}) {
    this.params = {
      baseGross: 0.5,
      minGross: 0.1,
      ...params,
    };
  }

  propose(universe: UniverseHistory, regime: RegimeState): Record<string, number> {
    const { baseGross, minGross } = this.params;
    const symbols = Object.keys(universe);
    if (symbols.length === 0) return {};
    // crisis 멤버십(0..1)이 강할수록 gross를 base→min으로 축소.
    const crisis = regime.membership.crisis ?? 0;
    const gross = baseGross! - (baseGross! - minGross!) * Math.min(1, Math.max(0, crisis));
    const equal = equalWeight(symbols, 1);
    return capSum(equal, Math.min(1, Math.max(0, gross)));
  }
}

/** 기본 방어 전략 묶음. */
export function defensiveStrategies(): RegimeStrategy[] {
  return [new LowVolTilt(), new DefensiveSectorRotation(), new CashRaise()];
}
