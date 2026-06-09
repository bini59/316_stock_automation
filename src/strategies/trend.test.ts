import { describe, it, expect } from "vitest";
import {
  TimeSeriesMomentum,
  CrossSectionalMomentum,
  DualMomentum,
} from "./trend";
import type { UniverseHistory } from "../types/strategy";
import { regimeState, seriesFromCloses, rising, falling } from "./_testutil";

const bull = regimeState({ bull: 1 });

/** 길이 N의 상승/하락 종목으로 유니버스 구성. */
function uni(spec: Record<string, number[]>): UniverseHistory {
  const out: Record<string, ReturnType<typeof seriesFromCloses>> = {};
  for (const [s, closes] of Object.entries(spec)) out[s] = seriesFromCloses(closes);
  return out;
}

describe("TimeSeriesMomentum", () => {
  it("200일선 위 + 모멘텀>0 종목만 후보", () => {
    const u = uni({
      UP: rising(300, 100, 1), // 위 + 모멘텀 양수
      DOWN: falling(300, 400, 1), // 200일선 아래 → 제외
    });
    const w = new TimeSeriesMomentum().propose(u, bull);
    expect(Object.keys(w)).toEqual(["UP"]);
    expect(w.UP).toBeGreaterThan(0);
  });

  it("후보 없으면 빈 비중", () => {
    const w = new TimeSeriesMomentum().propose(uni({ DOWN: falling(300, 400, 1) }), bull);
    expect(w).toEqual({});
  });

  it("weights 합 ≤ 1", () => {
    const u = uni({ A: rising(300), B: rising(300, 120), C: rising(300, 90) });
    const w = new TimeSeriesMomentum().propose(u, bull);
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(1 + 1e-9);
    expect(sum).toBeCloseTo(1, 6);
  });
});

describe("CrossSectionalMomentum", () => {
  it("랭크 상위 분위만 롱 (200일선 위 필터 적용)", () => {
    // 4개 모두 상승(200일선 위)이나 기울기 차등 → 상위 40%(=2개)만
    const u = uni({
      HOT: rising(300, 100, 3),
      WARM: rising(300, 100, 2),
      MILD: rising(300, 100, 1),
      COOL: rising(300, 100, 0.5),
    });
    const w = new CrossSectionalMomentum({ topQuantile: 0.5 }).propose(u, bull);
    const picked = Object.keys(w).sort();
    expect(picked).toEqual(["HOT", "WARM"]);
  });

  it("200일선 아래는 랭크가 높아도 제외", () => {
    const u = uni({
      UP: rising(300, 100, 1),
      DOWNFAST: falling(300, 500, 2), // 아래 → 후보 제외
    });
    const w = new CrossSectionalMomentum({ topQuantile: 1 }).propose(u, bull);
    expect(Object.keys(w)).toEqual(["UP"]);
  });
});

describe("DualMomentum", () => {
  it("절대 모멘텀 음수면 제외(약세 회피) — 200일선 필터가 아닌 abs 게이트로", () => {
    // WEAK: 길게 하락 후 최근 강한 반등 → 현재가 200일선 *위*(dist200>0)이지만
    //       12-1 모멘텀은 *음수*(12개월 전보다 낮음). 200일선 필터는 통과하므로
    //       제외는 오직 절대 모멘텀 게이트 때문이어야 한다(핵심 검증).
    const weak = [...falling(252, 300, 0.6), ...rising(60, 148, 1.5)];
    const u = uni({ STRONG: rising(312, 100, 2), WEAK: weak });
    const w = new DualMomentum({ topQuantile: 1 }).propose(u, bull);
    expect(Object.keys(w)).toEqual(["STRONG"]); // WEAK은 abs 게이트로 탈락
    expect(w.STRONG).toBeGreaterThan(0);
  });

  it("XS 모멘텀은 WEAK을 후보로 받는다(대조군) — abs 게이트만의 차이 확인", () => {
    // 동일 WEAK을 XS 모멘텀(절대 게이트 없음)에 넣으면 200일선 위라 후보에 든다.
    const weak = [...falling(252, 300, 0.6), ...rising(60, 148, 1.5)];
    const u = uni({ WEAK: weak });
    const xs = new CrossSectionalMomentum({ topQuantile: 1 }).propose(u, bull);
    expect(Object.keys(xs)).toEqual(["WEAK"]); // XS는 받음 → 200일선 통과 입증
    const dual = new DualMomentum({ topQuantile: 1 }).propose(u, bull);
    expect(dual).toEqual({}); // Dual은 abs 게이트로 거름
  });
});

describe("★ look-ahead: prefix 불변성", () => {
  it("CrossSectionalMomentum: prefix slice가 미래 미참조", () => {
    const full = uni({
      A: rising(400, 100, 2),
      B: rising(400, 100, 1),
    });
    const cut = 320;
    const prefix: UniverseHistory = {
      A: full.A!.slice(0, cut),
      B: full.B!.slice(0, cut),
    };
    const strat = new CrossSectionalMomentum();
    // prefix만으로 계산한 결과는 full을 cut에서 자른 것과 동일해야 한다.
    const fromPrefix = strat.propose(prefix, bull);
    const fromCutFull = strat.propose(
      { A: full.A!.slice(0, cut), B: full.B!.slice(0, cut) },
      bull,
    );
    expect(fromPrefix).toEqual(fromCutFull);
  });
});
