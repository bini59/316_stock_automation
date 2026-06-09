import { describe, it, expect } from "vitest";
import { NeutralSentimentSource } from "./pipeline";
import { computeAggressiveness } from "./aggressiveness";
import type { AggressivenessConfig, RiskInputs } from "../types/sentiment";
import type { RegimeState, RegimeLabel } from "../types/regime";

const NOW = 1_700_000_000_000;

function makeRisk(): RiskInputs {
  const membership: Record<RegimeLabel, number> = {
    bull: 1,
    bear: 0,
    chop: 0,
    crisis: 0,
  };
  const regime: RegimeState = {
    asOf: NOW,
    trend: 0,
    volatility: 0,
    trendQuality: 0,
    membership,
    label: "bull",
    confidence: 1,
  };
  return { realizedVol: 0.24, drawdown: 0, regime };
}

const CFG: AggressivenessConfig = {
  targetVol: 0.12,
  maxExposure: 1.0,
  useSentiment: true,
  sentimentMaxBoost: 0.15,
  sentimentMaxCut: 0.3,
  freshnessMs: 24 * 60 * 60 * 1000,
  minConfidence: 0.2,
};

describe("NeutralSentimentSource — 중립 흡수", () => {
  it("항상 undefined(신호 없음)를 반환한다", async () => {
    const src = new NeutralSentimentSource();
    await expect(src.fetch(NOW)).resolves.toBeUndefined();
  });

  it("스텁 출력을 적극도에 넣으면 베이스라인과 동일", async () => {
    const src = new NeutralSentimentSource();
    const signal = await src.fetch(NOW);
    const r = computeAggressiveness(makeRisk(), CFG, signal, NOW);
    expect(r.aggressiveness).toBeCloseTo(r.base, 10);
    expect(r.sentimentApplied).toBeCloseTo(1.0, 10);
  });

  it("name 식별자를 노출한다", () => {
    expect(new NeutralSentimentSource().name).toBe("neutral-stub");
  });
});
