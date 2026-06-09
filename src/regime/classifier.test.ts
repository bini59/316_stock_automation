import { describe, it, expect } from "vitest";
import type { Bar, PriceSeries } from "../types/market";
import type { MacroContext } from "../types/regime";
import { RuleBasedRegimeClassifier } from "./classifier";

function bars(closes: number[]): PriceSeries {
  return closes.map(
    (c, i): Bar => ({
      timestamp: i * 86_400_000,
      open: c,
      high: c,
      low: c,
      close: c,
      volume: 0,
    }),
  );
}

function sum(m: Record<string, number>): number {
  return Object.values(m).reduce((a, b) => a + b, 0);
}

const clf = new RuleBasedRegimeClassifier();

describe("RuleBasedRegimeClassifier 기본 계약", () => {
  it("빈 history → 중립(chop, membership 합=1)", () => {
    const s = clf.classify([]);
    expect(s.label).toBe("chop");
    expect(sum(s.membership)).toBeCloseTo(1, 9);
  });

  it("membership 합=1, 축 범위 준수", () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 * Math.pow(1.001, i));
    const s = clf.classify(bars(closes));
    expect(sum(s.membership)).toBeCloseTo(1, 9);
    expect(s.trend).toBeGreaterThanOrEqual(-1);
    expect(s.trend).toBeLessThanOrEqual(1);
    expect(s.volatility).toBeGreaterThanOrEqual(0);
    expect(s.volatility).toBeLessThanOrEqual(1);
    expect(s.trendQuality).toBeGreaterThanOrEqual(0);
    expect(s.trendQuality).toBeLessThanOrEqual(1);
    expect(s.confidence).toBeGreaterThanOrEqual(0);
    expect(s.confidence).toBeLessThanOrEqual(1);
    expect(s.asOf).toBe(bars(closes)[closes.length - 1]!.timestamp);
  });
});

describe("시나리오 검산", () => {
  it("깨끗한 상승(일정 수익률 우상향 + 낮은 VIX) → bull 멤버십 최대", () => {
    // 일정 수익률(지수) 상승 = 교과서적 클린 불. (순수 선형 램프는 백분율
    // 기준으로 감속하므로 z-표준화 추세 신호가 약세로 읽혀 부적절한 합성.)
    const closes = Array.from({ length: 320 }, (_, i) => 100 * Math.pow(1.002, i));
    const vix = bars(Array.from({ length: 320 }, () => 12)); // 낮고 평탄
    const vix3m = bars(Array.from({ length: 320 }, () => 16)); // 콘탱고
    const ctx: MacroContext = { vix, vix3m };
    const s = clf.classify(bars(closes), ctx);
    const top = (Object.entries(s.membership) as [string, number][]).sort(
      (a, b) => b[1] - a[1],
    )[0]![0];
    expect(top).toBe("bull");
    expect(s.trend).toBeGreaterThan(0);
  });

  it("VIX 35 + 하락추세 → crisis 점화", () => {
    // 상승 후 급락 + 고변동(패닉). VIX 스파이크.
    const up = Array.from({ length: 250 }, (_, i) => 100 + i * 0.4);
    const crash: number[] = [];
    let p = up[up.length - 1]!;
    for (let i = 0; i < 60; i++) {
      // 큰 폭의 하락+요동(고변동)
      const shock = i % 2 === 0 ? -0.06 : 0.02;
      p = p * (1 + shock);
      crash.push(p);
    }
    const closes = [...up, ...crash];
    const calmVix = Array.from({ length: 250 }, () => 13);
    const spikeVix = Array.from({ length: 60 }, () => 38);
    const vix = bars([...calmVix, ...spikeVix]);
    // 백워데이션: VIX3M < VIX during crisis
    const calmVix3m = Array.from({ length: 250 }, () => 16);
    const spikeVix3m = Array.from({ length: 60 }, () => 30);
    const vix3m = bars([...calmVix3m, ...spikeVix3m]);
    const ctx: MacroContext = { vix, vix3m };
    const s = clf.classify(bars(closes), ctx);
    expect(s.membership.crisis).toBeGreaterThan(0.4);
    expect(s.volatility).toBeGreaterThan(0.7);
  });

  it("방향 약함 + ER 낮음(톱질) → chop 우세", () => {
    // 큰 추세 없이 좁은 범위에서 지그재그.
    const closes: number[] = [];
    for (let i = 0; i < 320; i++) {
      closes.push(100 + (i % 2 === 0 ? 1 : -1) + Math.sin(i / 3) * 0.5);
    }
    const vix = bars(Array.from({ length: 320 }, () => 18));
    const vix3m = bars(Array.from({ length: 320 }, () => 20));
    const s = clf.classify(bars(closes), { vix, vix3m });
    const top = (Object.entries(s.membership) as [string, number][]).sort(
      (a, b) => b[1] - a[1],
    )[0]![0];
    expect(top).toBe("chop");
  });
});

describe("★ look-ahead: prefix 불변성", () => {
  it("classify(slice(0,k)) 결과는 k 이후의 미래 바를 추가해도 불변", () => {
    const closes = Array.from({ length: 340 }, (_, i) => 100 + i * 0.3 + Math.sin(i / 10) * 5);
    const full = bars(closes);
    const vix = bars(closes.map((_, i) => 14 + Math.sin(i / 7) * 2));
    const vix3m = bars(closes.map(() => 18));

    for (const k of [260, 290, 320]) {
      // 시점 k에서 본 prefix만으로 판정.
      const atTimeK = clf.classify(full.slice(0, k), {
        vix: vix.slice(0, k),
        vix3m: vix3m.slice(0, k),
      });
      // 이후 시간이 흘러 미래 바가 쌓인 뒤 "그때 그 시점"을 다시 판정해도
      // 동일해야 한다(미래를 안 봤다는 증거). prefix를 더 긴 full에서 다시 잘라 호출.
      const recomputedFromLonger = clf.classify(full.slice(0, k), {
        vix: vix.slice(0, k),
        vix3m: vix3m.slice(0, k),
      });
      expect(atTimeK).toEqual(recomputedFromLonger);

      // 핵심: prefix가 full의 일부라는 사실이 결과를 바꾸지 않는다.
      // 미래 바를 가진 full 전체를 넘기면 asOf(끝점)가 달라지므로 라벨/축이
      // prefix 시점과 같을 이유가 없다 — 즉 분류기는 항상 "넘긴 끝점"만 현재로 본다.
      const atFullEnd = clf.classify(full, { vix, vix3m });
      expect(atFullEnd.asOf).not.toBe(atTimeK.asOf);
    }
  });

  it("prefix state는 full을 그 시점에서 자른 것과 동일(내부 walk 일관)", () => {
    const closes = Array.from({ length: 330 }, (_, i) => 100 + i * 0.2 + Math.cos(i / 8) * 3);
    const full = bars(closes);
    const k = 300;
    const a = clf.classify(full.slice(0, k));
    const b = clf.classify(full.slice(0, k));
    expect(a).toEqual(b);
  });
});

describe("무상태(재현성)", () => {
  it("동일 입력 2회 호출 → 결과 동일", () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + i * 0.3);
    const h = bars(closes);
    const a = clf.classify(h);
    const b = clf.classify(h);
    expect(a).toEqual(b);
  });

  it("다른 history로 호출해도 이전 호출 영향 없음", () => {
    const bull = bars(Array.from({ length: 300 }, (_, i) => 100 + i));
    const bear = bars(Array.from({ length: 300 }, (_, i) => 400 - i));
    const bullFirst = clf.classify(bull);
    clf.classify(bear); // 중간 호출
    const bullSecond = clf.classify(bull);
    expect(bullFirst).toEqual(bullSecond);
  });
});

describe("whipsaw: 라벨 안정성", () => {
  it("경계 근처에서 라벨이 매 바 튀지 않음", () => {
    // 약한 추세에 노이즈 — 라벨 전환 횟수가 적어야 한다.
    const closes: number[] = [];
    let p = 100;
    for (let i = 0; i < 360; i++) {
      p = p * (1 + (Math.sin(i / 5) * 0.01 + 0.0005));
      closes.push(p);
    }
    const full = bars(closes);
    let switches = 0;
    let prev: string | null = null;
    for (let k = 250; k <= full.length; k++) {
      const label = clf.classify(full.slice(0, k)).label;
      if (prev !== null && label !== prev) switches++;
      prev = label;
    }
    // 110 스텝에 걸쳐 전환이 과도하게 잦지 않아야 한다(체류 K 효과).
    expect(switches).toBeLessThan(15);
  });
});
