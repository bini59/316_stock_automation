import { describe, it, expect } from "vitest";
import type { RegimeLabel } from "../types/regime";
import { deriveHardLabel, type HysteresisParams } from "./hysteresis";

const P: HysteresisParams = { enter: 0.5, exit: 0.4, dwellK: 3 };

type M = Record<RegimeLabel, number>;
function m(bull: number, bear: number, chop: number, crisis: number): M {
  return { bull, bear, chop, crisis };
}

describe("deriveHardLabel", () => {
  it("빈 시계열 → chop", () => {
    expect(deriveHardLabel([], P)).toBe("chop");
  });

  it("일관 bull → bull", () => {
    const series = Array.from({ length: 10 }, () => m(0.8, 0.05, 0.1, 0.05));
    expect(deriveHardLabel(series, P)).toBe("bull");
  });

  it("체류 K 미만 자격 → 전환 안 함", () => {
    // bull로 시작, bear 후보가 2일만 자격(K=3 미만) → 여전히 bull.
    const start = m(0.8, 0.05, 0.1, 0.05);
    const bearQual = m(0.05, 0.7, 0.2, 0.05); // bear>enter, bull<exit
    const series = [start, bearQual, bearQual];
    expect(deriveHardLabel(series, P)).toBe("bull");
  });

  it("체류 K 충족 → 전환", () => {
    const start = m(0.8, 0.05, 0.1, 0.05);
    const bearQual = m(0.05, 0.7, 0.2, 0.05);
    const series = [start, bearQual, bearQual, bearQual];
    expect(deriveHardLabel(series, P)).toBe("bear");
  });

  it("슈미트 밴드: 현재 라벨이 exit 위면 전환 자격 없음", () => {
    // bull로 시작, bear가 1위지만 bull이 여전히 0.45(>exit 0.4) → 자격 없음.
    const start = m(0.8, 0.05, 0.1, 0.05);
    const ambiguous = m(0.45, 0.55, 0, 0); // bear>enter지만 bull(0.45)>exit
    const series = [start, ambiguous, ambiguous, ambiguous, ambiguous];
    expect(deriveHardLabel(series, P)).toBe("bull");
  });

  it("whipsaw: 후보가 끊기면 카운터 리셋 → 안 튄다", () => {
    const start = m(0.8, 0.05, 0.1, 0.05);
    const bearQual = m(0.05, 0.7, 0.2, 0.05);
    const backToBull = m(0.8, 0.05, 0.1, 0.05);
    // bear 2일 → bull 복귀 → bear 2일: 연속 3일이 안 되므로 bull 유지.
    const series = [start, bearQual, bearQual, backToBull, bearQual, bearQual];
    expect(deriveHardLabel(series, P)).toBe("bull");
  });

  it("무상태: 동일 입력 두 번 → 동일 결과", () => {
    const series = [
      m(0.8, 0.05, 0.1, 0.05),
      m(0.05, 0.7, 0.2, 0.05),
      m(0.05, 0.7, 0.2, 0.05),
      m(0.05, 0.7, 0.2, 0.05),
    ];
    expect(deriveHardLabel(series, P)).toBe(deriveHardLabel(series, P));
  });
});
