import { describe, it, expect } from "vitest";
import { ZScoreReversion, RsiReversion, BollingerReversion } from "./meanrev";
import { runPool } from "./pool";
import type { UniverseHistory } from "../types/strategy";
import { regimeState, seriesFromCloses, rising } from "./_testutil";

const chop = regimeState({ chop: 1 }, "chop");
const bull = regimeState({ bull: 1 }, "bull");

function uni(spec: Record<string, number[]>): UniverseHistory {
  const out: Record<string, ReturnType<typeof seriesFromCloses>> = {};
  for (const [s, closes] of Object.entries(spec)) out[s] = seriesFromCloses(closes);
  return out;
}

/** 200일선 위에서 단기 과매도를 만든 시계열: 길게 상승 후 마지막에 급락. */
function aboveTrendOversold(): number[] {
  return [...rising(260, 100, 1), 358, 350, 340, 332]; // 마지막 며칠 급락(z<<0, RSI<<10)
}

describe("국면 게이트 (핵심 가설)", () => {
  it("affinity는 chop만 → bull에서 activation 0 (runPool이 제외)", () => {
    const u = uni({ X: aboveTrendOversold() });
    const out = runPool([new ZScoreReversion()], u, bull);
    expect(out).toHaveLength(0); // 추세장에서 비활성
  });

  it("chop에서는 활성", () => {
    const u = uni({ X: aboveTrendOversold() });
    const out = runPool([new ZScoreReversion()], u, chop);
    expect(out).toHaveLength(1);
    expect(out[0]!.activation).toBeCloseTo(1, 10);
  });
});

describe("추세 역행 금지 (200일선 위 과매도만)", () => {
  it("하락 추세(200일선 아래)의 과매도는 매수 안 함", () => {
    // 길게 하락하다 살짝 더 급락 → z<<0 이지만 200일선 아래 → 게이트가 막음
    const downOversold = [
      ...Array.from({ length: 260 }, (_, i) => 400 - i),
      138,
      130,
      120,
      110,
    ];
    const u = uni({ DOWN: downOversold });
    expect(new ZScoreReversion().propose(u, chop)).toEqual({});
    expect(new RsiReversion().propose(u, chop)).toEqual({});
    expect(new BollingerReversion().propose(u, chop)).toEqual({});
  });

  it("200일선 위 과매도는 매수", () => {
    const u = uni({ UP: aboveTrendOversold() });
    expect(Object.keys(new ZScoreReversion().propose(u, chop))).toEqual(["UP"]);
    expect(Object.keys(new RsiReversion().propose(u, chop))).toEqual(["UP"]);
  });
});

describe("과매도 아님 → 매수 안 함", () => {
  it("일변도 상승(과매도 아님)이면 빈 비중", () => {
    const u = uni({ UP: rising(300, 100, 1) });
    expect(new ZScoreReversion().propose(u, chop)).toEqual({});
    expect(new RsiReversion().propose(u, chop)).toEqual({});
  });
});

describe("weights 합 ≤ 1", () => {
  it("여러 과매도 종목 동일가중 합 ≈ 1", () => {
    const u = uni({ A: aboveTrendOversold(), B: aboveTrendOversold() });
    const w = new ZScoreReversion().propose(u, chop);
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });
});

describe("★ look-ahead: prefix 불변성", () => {
  it("propose(prefix)가 미래 미참조", () => {
    const full = [...rising(300, 100, 1), 398, 390, 380, 370, 380, 390];
    const cut = 304;
    const series = seriesFromCloses(full);
    const prefix: UniverseHistory = { X: series.slice(0, cut) };
    const strat = new ZScoreReversion();
    expect(strat.propose(prefix, chop)).toEqual(
      strat.propose({ X: series.slice(0, cut) }, chop),
    );
  });
});
