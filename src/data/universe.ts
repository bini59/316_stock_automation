/**
 * 시점별 유니버스 공급 (TODO 3.2, docs/strategy/strategy-pool.md 6절).
 *
 * ★ 생존편향 차단(validation.md 2번): 백테스트는 "지금 살아남은 종목"이 아니라
 * 그 시점에 실제 존재·편입돼 있던 종목만 써야 한다. point-in-time 구성 데이터가
 * 없으면 섹터 ETF 유니버스로 시작해 편향을 줄인다(ETF는 상폐가 드묾).
 *
 * 전략은 "받은 것만" 본다 — 유니버스 구성은 이 레이어가 시점별로 공급한다.
 */

/**
 * 섹터 ETF 기본 유니버스(SPDR Select Sector). 생존편향이 거의 없는 출발점.
 * 개별주 point-in-time 데이터 확보 전까지 기본값으로 사용.
 */
export const SECTOR_ETF_UNIVERSE: readonly string[] = [
  "XLK", // 기술
  "XLF", // 금융
  "XLV", // 헬스케어
  "XLE", // 에너지
  "XLI", // 산업재
  "XLY", // 임의소비재
  "XLP", // 필수소비재
  "XLU", // 유틸리티
  "XLB", // 소재
  "XLRE", // 부동산
  "XLC", // 커뮤니케이션
];

/** 방어 섹터(bear/crisis 틸트 대상) */
export const DEFENSIVE_SECTORS: readonly string[] = ["XLP", "XLU", "XLV"];

export interface UniverseProvider {
  /** 주어진 시점(epoch ms)에 편입돼 있던 심볼 목록 */
  symbolsAt(timestamp: number): readonly string[];
}

/** 고정 유니버스(시간 불변). 섹터 ETF 등 구성이 거의 안 변하는 경우. */
export class StaticUniverse implements UniverseProvider {
  private readonly symbols: readonly string[];
  constructor(symbols: readonly string[] = SECTOR_ETF_UNIVERSE) {
    this.symbols = [...symbols];
  }
  symbolsAt(_timestamp?: number): readonly string[] {
    return this.symbols;
  }
}

/** 구성 변경 이벤트: effectiveFrom 시점부터 members가 유효 */
export interface UniverseSnapshot {
  /** 이 구성이 유효해지는 시점(epoch ms) */
  effectiveFrom: number;
  members: readonly string[];
}

/**
 * point-in-time 유니버스. 시점별 구성 스냅샷(상폐·편출 포함)으로 생존편향을 차단.
 * symbolsAt(t) = t 이하 effectiveFrom 중 가장 최근 스냅샷의 members.
 */
export class PointInTimeUniverse implements UniverseProvider {
  private readonly snapshots: UniverseSnapshot[];
  constructor(snapshots: readonly UniverseSnapshot[]) {
    if (snapshots.length === 0) throw new Error("PointInTimeUniverse: 스냅샷이 비었음");
    this.snapshots = [...snapshots].sort((a, b) => a.effectiveFrom - b.effectiveFrom);
  }

  symbolsAt(timestamp: number): readonly string[] {
    let active: readonly string[] = [];
    for (const snap of this.snapshots) {
      if (snap.effectiveFrom <= timestamp) active = snap.members;
      else break;
    }
    return active;
  }
}
