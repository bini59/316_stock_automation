/**
 * 시뮬레이션 계좌 소스 (AccountSource 구현체).
 *
 * 백테스트·DRY_RUN 골격용. 토스 실어댑터(Phase 7)와 같은 인터페이스를 만족하므로
 * 정산·실행 파이프라인을 키 없이 검증할 수 있다.
 *
 * NAV = 현금 + 유니버스 보유 평가액 (account.ts 정의). 유니버스 밖 보유는
 * 평가액·NAV에서 제외하고 건드리지 않는다.
 */
import type { AccountSource } from "../../types/broker-port";
import type { AccountState, Holding } from "../../types/account";

export interface SimulatedAccountInit {
  readonly accountSeq?: string;
  readonly cash: number;
  /** 심볼→보유 (marketValue는 갱신 시점 평가액) */
  readonly holdings?: Readonly<Record<string, Holding>>;
  /** NAV 분모를 한정하는 유니버스. 미지정 시 전체 보유 포함 */
  readonly universe?: ReadonlySet<string>;
}

/**
 * 불변 시뮬레이션 계좌. 상태 변경은 새 인스턴스를 반환한다(coding-style).
 * asOf는 getState() 시점에 주입 가능(look-ahead: 현재 시점까지만 노출).
 */
export class SimulatedAccount implements AccountSource {
  private readonly accountSeq: string;
  private readonly cash: number;
  private readonly holdings: Readonly<Record<string, Holding>>;
  private readonly universe: ReadonlySet<string> | undefined;
  private readonly clock: () => number;

  constructor(init: SimulatedAccountInit, clock: () => number = () => Date.now()) {
    this.accountSeq = init.accountSeq ?? "SIM";
    this.cash = init.cash;
    this.holdings = init.holdings ?? {};
    this.universe = init.universe;
    this.clock = clock;
  }

  /** 유니버스 보유 평가액 합 (밖 보유 제외) */
  private managedHoldingsValue(): number {
    let sum = 0;
    for (const [sym, h] of Object.entries(this.holdings)) {
      if (this.universe && !this.universe.has(sym)) continue;
      sum += h.marketValue;
    }
    return sum;
  }

  async getState(): Promise<AccountState> {
    const nav = this.cash + this.managedHoldingsValue();
    return {
      accountSeq: this.accountSeq,
      baseCurrency: "USD",
      cash: this.cash,
      holdings: this.holdings,
      nav,
      asOf: this.clock(),
    };
  }

  /** 보유 평가액 갱신(불변). 시세 변동 시뮬레이션용 */
  withMarketValues(marketValues: Readonly<Record<string, number>>): SimulatedAccount {
    const next: Record<string, Holding> = {};
    for (const [sym, h] of Object.entries(this.holdings)) {
      const mv = marketValues[sym];
      next[sym] = mv === undefined ? h : { ...h, marketValue: mv };
    }
    return new SimulatedAccount(
      {
        accountSeq: this.accountSeq,
        cash: this.cash,
        holdings: next,
        ...(this.universe !== undefined ? { universe: this.universe } : {}),
      },
      this.clock,
    );
  }
}
