import { describe, it, expect } from "vitest";
import { computeAggressiveness } from "./aggressiveness";
import type {
  AggressivenessConfig,
  RiskInputs,
  SentimentSignal,
} from "../types/sentiment";
import type { RegimeState, RegimeLabel } from "../types/regime";

const NOW = 1_700_000_000_000;

function makeRegime(crisis: number): RegimeState {
  // membership 합 = 1 가정 (crisis + 나머지 분배). 본 레이어는 crisis만 사용.
  const rest = 1 - crisis;
  const membership: Record<RegimeLabel, number> = {
    bull: rest,
    bear: 0,
    chop: 0,
    crisis,
  };
  return {
    asOf: NOW,
    trend: 0,
    volatility: crisis,
    trendQuality: 0,
    membership,
    label: crisis >= 0.5 ? "crisis" : "bull",
    confidence: 1,
  };
}

function makeRisk(over: Partial<RiskInputs> = {}): RiskInputs {
  return {
    realizedVol: 0.12,
    drawdown: 0,
    regime: makeRegime(0),
    ...over,
  };
}

const BASE_CFG: AggressivenessConfig = {
  targetVol: 0.12,
  maxExposure: 1.0,
  useSentiment: true,
  sentimentMaxBoost: 0.15,
  sentimentMaxCut: 0.3,
  freshnessMs: 24 * 60 * 60 * 1000, // 1일
  minConfidence: 0.2,
};

describe("computeAggressiveness — 규칙 베이스라인", () => {
  it("평온: realizedVol==targetVol, dd 0, crisis 0 → 적극도 1.0", () => {
    const r = computeAggressiveness(makeRisk(), BASE_CFG);
    expect(r.base).toBeCloseTo(1.0, 10);
    expect(r.aggressiveness).toBeCloseTo(1.0, 10);
    expect(r.sentimentApplied).toBeCloseTo(1.0, 10);
  });

  it("vol-target 감쇠: realizedVol 2배 → A_vol 절반", () => {
    const r = computeAggressiveness(
      makeRisk({ realizedVol: 0.24 }),
      BASE_CFG,
    );
    expect(r.base).toBeCloseTo(0.5, 10);
  });

  it("vol-target 상한: realizedVol < targetVol여도 maxExposure로 클램프", () => {
    const r = computeAggressiveness(
      makeRisk({ realizedVol: 0.06 }),
      BASE_CFG,
    );
    // targetVol/realizedVol = 2 이지만 maxExposure=1.0로 클램프
    expect(r.base).toBeCloseTo(1.0, 10);
  });

  it("realizedVol=0 방어: 0 나눗셈 → maxExposure로 클램프", () => {
    const r = computeAggressiveness(
      makeRisk({ realizedVol: 0 }),
      BASE_CFG,
    );
    expect(r.base).toBeCloseTo(1.0, 10);
    expect(Number.isFinite(r.aggressiveness)).toBe(true);
  });

  it("crisis 멤버십 1 → A_crisis 0 → 적극도 0 수렴", () => {
    const r = computeAggressiveness(
      makeRisk({ regime: makeRegime(1) }),
      BASE_CFG,
    );
    expect(r.base).toBeCloseTo(0, 10);
    expect(r.aggressiveness).toBeCloseTo(0, 10);
  });

  it("crisis 멤버십 0.5 → A_crisis 0.5", () => {
    const r = computeAggressiveness(
      makeRisk({ regime: makeRegime(0.5) }),
      BASE_CFG,
    );
    expect(r.base).toBeCloseTo(0.5, 10);
  });
});

describe("ddBrake 경계 선형 검산", () => {
  it("dd 0.10 경계: 그대로 1.0", () => {
    const r = computeAggressiveness(
      makeRisk({ drawdown: 0.1 }),
      BASE_CFG,
    );
    expect(r.base).toBeCloseTo(1.0, 10);
  });

  it("dd 0.09: 1.0 (10% 미만은 무감쇠)", () => {
    const r = computeAggressiveness(
      makeRisk({ drawdown: 0.09 }),
      BASE_CFG,
    );
    expect(r.base).toBeCloseTo(1.0, 10);
  });

  it("dd 0.20: 선형 중간 → 1 - (0.20-0.10)/0.20 = 0.5", () => {
    const r = computeAggressiveness(
      makeRisk({ drawdown: 0.2 }),
      BASE_CFG,
    );
    expect(r.base).toBeCloseTo(0.5, 10);
  });

  it("dd 0.30 경계: 노출 0", () => {
    const r = computeAggressiveness(
      makeRisk({ drawdown: 0.3 }),
      BASE_CFG,
    );
    expect(r.base).toBeCloseTo(0, 10);
  });

  it("dd 0.50: 0 (30% 이상 전부 0)", () => {
    const r = computeAggressiveness(
      makeRisk({ drawdown: 0.5 }),
      BASE_CFG,
    );
    expect(r.base).toBeCloseTo(0, 10);
  });
});

describe("그레이스풀 디그레이데이션 — base와 정확히 동일", () => {
  const goodSentiment: SentimentSignal = {
    score: 1,
    confidence: 1,
    asOf: NOW,
  };

  it("useSentiment=false → base와 동일, reasons에 사유", () => {
    const cfg = { ...BASE_CFG, useSentiment: false };
    const r = computeAggressiveness(makeRisk(), cfg, goodSentiment, NOW);
    const baseRun = computeAggressiveness(makeRisk(), cfg);
    expect(r.aggressiveness).toBeCloseTo(r.base, 10);
    expect(r.aggressiveness).toBeCloseTo(baseRun.base, 10);
    expect(r.sentimentApplied).toBeCloseTo(1.0, 10);
    expect(r.reasons.some((x) => /sentiment.*off|off/i.test(x))).toBe(true);
  });

  it("sentiment undefined → base와 동일", () => {
    const r = computeAggressiveness(makeRisk(), BASE_CFG, undefined, NOW);
    expect(r.aggressiveness).toBeCloseTo(r.base, 10);
    expect(r.sentimentApplied).toBeCloseTo(1.0, 10);
  });

  it("낡은 감성(asOf 오래됨) 무시 → base, reasons에 stale", () => {
    const stale: SentimentSignal = {
      score: -1,
      confidence: 1,
      asOf: NOW - BASE_CFG.freshnessMs - 1,
    };
    const r = computeAggressiveness(makeRisk(), BASE_CFG, stale, NOW);
    expect(r.aggressiveness).toBeCloseTo(r.base, 10);
    expect(r.sentimentApplied).toBeCloseTo(1.0, 10);
    expect(r.reasons.some((x) => /stale/i.test(x))).toBe(true);
  });

  it("confidence < minConfidence 무시 → base", () => {
    const weak: SentimentSignal = {
      score: -1,
      confidence: 0.1,
      asOf: NOW,
    };
    const r = computeAggressiveness(makeRisk(), BASE_CFG, weak, NOW);
    expect(r.aggressiveness).toBeCloseTo(r.base, 10);
    expect(r.sentimentApplied).toBeCloseTo(1.0, 10);
    expect(r.reasons.some((x) => /confidence/i.test(x))).toBe(true);
  });

  it("now 인자 없으면 신선도 판단 불가 → 감성 무시(base)", () => {
    const r = computeAggressiveness(makeRisk(), BASE_CFG, goodSentiment);
    expect(r.aggressiveness).toBeCloseTo(r.base, 10);
    expect(r.sentimentApplied).toBeCloseTo(1.0, 10);
  });
});

describe("look-ahead 차단 — 미래 감성 누출 금지", () => {
  it("asOf > now (미래 감성)면 반영 안 함 → base, reasons에 future/stale", () => {
    const future: SentimentSignal = {
      score: -1,
      confidence: 1,
      asOf: NOW + 60_000, // 의사결정 시점 이후
    };
    const r = computeAggressiveness(makeRisk(), BASE_CFG, future, NOW);
    expect(r.aggressiveness).toBeCloseTo(r.base, 10);
    expect(r.sentimentApplied).toBeCloseTo(1.0, 10);
    expect(r.reasons.some((x) => /future|stale|look-ahead/i.test(x))).toBe(
      true,
    );
  });
});

describe("AI 감성 오버레이 — 경계 있는 미세조정", () => {
  it("상방 부스트: score+1 conf 1 → adj = 1+0.15 → A_base*1.15 (단 클램프)", () => {
    // base를 1 미만으로 만들어 클램프 영향 배제: realizedVol 0.24 → base 0.5
    const r = computeAggressiveness(
      makeRisk({ realizedVol: 0.24 }),
      BASE_CFG,
      { score: 1, confidence: 1, asOf: NOW },
      NOW,
    );
    expect(r.base).toBeCloseTo(0.5, 10);
    expect(r.sentimentApplied).toBeCloseTo(1.15, 10);
    expect(r.aggressiveness).toBeCloseTo(0.575, 10);
  });

  it("하방 컷: score-1 conf 1 → adj = 1-0.30 → A_base*0.70", () => {
    const r = computeAggressiveness(
      makeRisk({ realizedVol: 0.24 }),
      BASE_CFG,
      { score: -1, confidence: 1, asOf: NOW },
      NOW,
    );
    expect(r.base).toBeCloseTo(0.5, 10);
    expect(r.sentimentApplied).toBeCloseTo(0.7, 10);
    expect(r.aggressiveness).toBeCloseTo(0.35, 10);
  });

  it("confidence 가중: score+1 conf 0.5 → s_eff 0.5 → adj 1+0.15*0.5=1.075", () => {
    const r = computeAggressiveness(
      makeRisk({ realizedVol: 0.24 }),
      BASE_CFG,
      { score: 1, confidence: 0.5, asOf: NOW },
      NOW,
    );
    expect(r.sentimentApplied).toBeCloseTo(1.075, 10);
  });

  it("비대칭: 동일 |s_eff|에서 하방 컷이 상방 부스트보다 크게 작용", () => {
    const up = computeAggressiveness(
      makeRisk({ realizedVol: 0.24 }),
      BASE_CFG,
      { score: 1, confidence: 1, asOf: NOW },
      NOW,
    );
    const down = computeAggressiveness(
      makeRisk({ realizedVol: 0.24 }),
      BASE_CFG,
      { score: -1, confidence: 1, asOf: NOW },
      NOW,
    );
    const boostMagnitude = up.aggressiveness - up.base; // +
    const cutMagnitude = down.base - down.aggressiveness; // +
    expect(cutMagnitude).toBeGreaterThan(boostMagnitude);
  });

  it("상방 부스트가 maxExposure를 넘으면 클램프", () => {
    // base 1.0 * 1.15 = 1.15 → 1.0으로 클램프
    const r = computeAggressiveness(makeRisk(), BASE_CFG, {
      score: 1,
      confidence: 1,
      asOf: NOW,
    }, NOW);
    expect(r.base).toBeCloseTo(1.0, 10);
    expect(r.aggressiveness).toBeCloseTo(1.0, 10);
  });

  it("score 0 → adj 1.0 (중립 감성은 무영향)", () => {
    const r = computeAggressiveness(
      makeRisk({ realizedVol: 0.24 }),
      BASE_CFG,
      { score: 0, confidence: 1, asOf: NOW },
      NOW,
    );
    expect(r.sentimentApplied).toBeCloseTo(1.0, 10);
    expect(r.aggressiveness).toBeCloseTo(r.base, 10);
  });
});

describe("순수성 — 입력 불변", () => {
  it("입력 객체를 변형하지 않는다", () => {
    const risk = makeRisk({ realizedVol: 0.24, drawdown: 0.2 });
    const cfg = { ...BASE_CFG };
    const sentiment: SentimentSignal = { score: -1, confidence: 1, asOf: NOW };
    const riskSnap = JSON.stringify(risk);
    const cfgSnap = JSON.stringify(cfg);
    const sentSnap = JSON.stringify(sentiment);
    computeAggressiveness(risk, cfg, sentiment, NOW);
    expect(JSON.stringify(risk)).toBe(riskSnap);
    expect(JSON.stringify(cfg)).toBe(cfgSnap);
    expect(JSON.stringify(sentiment)).toBe(sentSnap);
  });

  it("같은 입력 같은 출력", () => {
    const args = [makeRisk({ realizedVol: 0.2 }), BASE_CFG, { score: -0.5, confidence: 0.8, asOf: NOW }, NOW] as const;
    const a = computeAggressiveness(...args);
    const b = computeAggressiveness(...args);
    expect(a).toEqual(b);
  });
});
