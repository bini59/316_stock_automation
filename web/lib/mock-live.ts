/**
 * mock LiveSnapshot — 토스 키 확보 전 /live 골격용.
 *
 * 엔진 LiveSnapshot 계약(src/types/artifact.ts)에 **타입으로** 정합한다.
 * 키 확보 후엔 artifacts/live/snapshot.json(실데이터)이 이 mock 을 덮어쓴다
 * (artifacts.ts: snapshot 파일 있으면 그걸 우선).
 *
 * 어떤 매매 로직도 없다 — 그럴듯한 상수 상태일 뿐.
 */
import type { LiveSnapshot, RegimeLabel } from "./engine-types";

export function mockLiveSnapshot(): LiveSnapshot {
  const now = Date.now();

  const membership: Record<RegimeLabel, number> = {
    bull: 0.58,
    bear: 0.07,
    chop: 0.31,
    crisis: 0.04,
  };

  return {
    asOf: now,
    mode: "DRY_RUN",
    account: {
      accountSeq: "MOCK-0001",
      baseCurrency: "USD",
      cash: 18430.55,
      nav: 102350.12,
      asOf: now,
      holdings: {
        SPY: {
          symbol: "SPY",
          quantity: 80,
          avgPrice: 512.4,
          marketValue: 43120.0,
          currency: "USD",
        },
        QQQ: {
          symbol: "QQQ",
          quantity: 55,
          avgPrice: 458.1,
          marketValue: 26790.5,
          currency: "USD",
        },
        GLD: {
          symbol: "GLD",
          quantity: 70,
          avgPrice: 198.2,
          marketValue: 14009.07,
          currency: "USD",
        },
      },
    },
    regime: {
      asOf: now,
      trend: 0.41,
      volatility: 0.22,
      trendQuality: 0.63,
      membership,
      label: "bull",
      confidence: 0.52,
    },
    aggressiveness: 0.68,
    targetWeights: {
      SPY: 0.4,
      QQQ: 0.28,
      GLD: 0.12,
      // 현금 20% 는 합 부족분으로 암시
    },
    openOrders: [
      {
        symbol: "QQQ",
        side: "BUY",
        notional: 2400,
        reason: "rebalance",
        clientOrderId: "mock-ord-77a3",
      },
      {
        symbol: "GLD",
        side: "SELL",
        notional: 1500,
        reason: "exit (trim to target)",
        clientOrderId: "mock-ord-77a4",
      },
    ],
    recentDecisions: [
      `${ts(now)}  regime=bull (conf 0.52) → aggressiveness 0.68`,
      `${ts(now - 60000)}  target SPY 0.40 / QQQ 0.28 / GLD 0.12 / cash 0.20`,
      `${ts(now - 120000)}  drawdown brake: OFF, vol brake: OFF`,
      `${ts(now - 180000)}  meta-allocation: corr-dedup applied (QQQ vs SPY ρ=0.86)`,
      `${ts(now - 240000)}  mode=DRY_RUN — orders computed, NOT submitted`,
    ],
    pnl: {
      day: 612.34,
      total: 2350.12,
    },
  };
}

function ts(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}
