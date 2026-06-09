/**
 * 메타 배분 — 전략 간 자본 배분 + 종목 비중 합성 (TODO 4.4.1-4.4.3).
 * 설계: docs/strategy/meta-allocation.md (2~4절).
 *
 * 메타는 **상대 비중만** 만든다(Σ ≤ 1). 전체 크기는 적극도(sentiment)가 곱한다.
 * 핵심 가치는 **상관 중복 베팅 제거** — 같은 종목/같은 패밀리가 책을 독식하지 못하게.
 *
 * ★ 순수 함수: 같은 입력 → 같은 출력. 외부 상태·시간·난수 없음.
 * ★ look-ahead 무관: proposals/strategyReturns는 호출자(엔진)가 잘라준 "현재까지".
 *   이 모듈은 미래 구간을 인덱싱하지 않는다. 상관 추정은 diversify에 위임하며,
 *   그곳도 trailing 수익률만 본다.
 */
import type { Allocate, AllocationConfig, AllocationInput } from "../types/allocation";
import type { StrategyFamily, StrategyProposal } from "../types/strategy";
import { diversifiedBase } from "./diversify";

/**
 * 전략 이름에서 패밀리를 추론한다(순수·결정적).
 *
 * StrategyProposal 계약에는 family가 없으므로(타입 수정 금지), 이름 키워드로
 * 매핑한다. RegimeStrategy.family와 일관된 명명을 전제로 한다. 미지의 이름은
 * 가장 보수적으로(상관 높다고 가정) "trend" 버킷에 넣어 예산 상한이 더 잘 걸리게 한다.
 */
export function familyOf(strategyName: string): StrategyFamily {
  const n = strategyName.toLowerCase();
  if (n.includes("cash")) return "cash";
  if (
    n.includes("defens") ||
    n.includes("defence") ||
    n.includes("defense") ||
    n.includes("shelter") ||
    n.includes("hedge")
  ) {
    return "defensive";
  }
  if (
    n.includes("meanrev") ||
    n.includes("mean-rev") ||
    n.includes("mean_rev") ||
    n.includes("revers") ||
    n.includes("revert") ||
    n.includes("contrarian")
  ) {
    return "meanrev";
  }
  if (
    n.includes("trend") ||
    n.includes("momentum") ||
    n.includes("momo") ||
    n.includes("breakout")
  ) {
    return "trend";
  }
  return "trend";
}

/** 합이 1이 되도록 정규화. 합이 0이면 모두 0 유지(전부 현금). */
function normalizeToOne(base: Record<string, number>): Record<string, number> {
  const total = Object.values(base).reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (total <= 0) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v > 0) out[k] = v / total;
  }
  return out;
}

/**
 * 패밀리 예산 상한(절대 상한). **이미 Σ=1로 정규화된** alloc에 적용한다.
 * 같은 family의 합이 cap을 넘으면 그 패밀리 내부에서 비례 축소하고,
 * ★ 줄어든 예산은 다른 패밀리로 재분배하지 않고 암묵적 현금으로 둔다
 * (재정규화로 cap이 무력화되는 구조적 과집중을 차단 — QA H1).
 * 결과 합은 ≤ 1.
 */
function applyFamilyBudget(
  alloc: Record<string, number>,
  familyByStrategy: Readonly<Record<string, StrategyFamily>>,
  cap: number,
  reasons: string[],
): Record<string, number> {
  const familySum: Record<string, number> = {};
  for (const [s, w] of Object.entries(alloc)) {
    const fam = familyByStrategy[s] ?? "trend";
    familySum[fam] = (familySum[fam] ?? 0) + (w > 0 ? w : 0);
  }
  const out: Record<string, number> = { ...alloc };
  for (const [fam, sum] of Object.entries(familySum)) {
    // cash 패밀리는 예산 상한 면제: 현금은 리스크의 부재이므로 책을 독식해도 안전
    // (위기에 전량 현금화가 막히면 안 됨). 상한은 상관된 리스크 베팅에만 적용.
    if (fam === "cash") continue;
    if (sum > cap && sum > 0) {
      const scale = cap / sum; // 패밀리 합을 정확히 cap으로 — 차액은 현금
      for (const [s, w] of Object.entries(out)) {
        if ((familyByStrategy[s] ?? "trend") === fam) out[s] = w * scale;
      }
      reasons.push(`family ${fam} capped`);
    }
  }
  return out;
}

/**
 * 종목 비중 합성: w[sym] = Σ_s strategyAlloc[s] × proposal.weights[sym].
 * 같은 종목은 자동 병합(이중 카운트가 아니라 강한 확신).
 */
function synthesize(
  proposals: readonly StrategyProposal[],
  strategyAlloc: Readonly<Record<string, number>>,
): Record<string, number> {
  const w: Record<string, number> = {};
  for (const p of proposals) {
    const a = strategyAlloc[p.strategy];
    if (typeof a !== "number" || a <= 0) continue;
    for (const [sym, sw] of Object.entries(p.weights)) {
      if (!Number.isFinite(sw) || sw <= 0) continue;
      w[sym] = (w[sym] ?? 0) + a * sw;
    }
  }
  return w;
}

/**
 * 종목 집중 상한으로 클립한 뒤 Σ ≤ 1로 재정규화.
 * - 클립으로 줄어든 책은 그대로 두어 차액이 암묵적 현금이 되게 한다(키우지 않음).
 * - 클립 후에도 합이 1을 넘으면 1로 비례 축소(현금화).
 */
function guardAndRenormalize(
  raw: Record<string, number>,
  maxPerSymbol: number,
  reasons: string[],
): Record<string, number> {
  let clipped = false;
  const capped: Record<string, number> = {};
  for (const [sym, w] of Object.entries(raw)) {
    if (w <= 0) continue;
    if (w > maxPerSymbol) {
      capped[sym] = maxPerSymbol;
      clipped = true;
    } else {
      capped[sym] = w;
    }
  }
  if (clipped) reasons.push("symbol concentration capped");

  const sum = Object.values(capped).reduce((a, b) => a + b, 0);
  if (sum <= 1 || sum <= 0) return capped;
  const scale = 1 / sum;
  const out: Record<string, number> = {};
  for (const [sym, w] of Object.entries(capped)) out[sym] = w * scale;
  reasons.push("gross renormalized to 1");
  return out;
}

/**
 * 메타 배분 순수 함수 (Allocate 계약 구현).
 *
 * 파이프라인(meta-allocation.md 2절):
 *   1. 후보 필터  activation ≥ minActivation
 *   2. 전략 간 배분  base = activation → (v2: 상관 다양화) → 패밀리 예산 → normalize(Σ=1)
 *   3. 종목 비중 합성  w[sym] = Σ strategyAlloc × proposal.weights[sym]
 *   4. 포지션 가드  종목 집중 상한 → 재정규화(Σ ≤ 1)
 */
export const allocate: Allocate = (
  input: AllocationInput,
  cfg: AllocationConfig,
): ReturnType<Allocate> => {
  const reasons: string[] = [];

  // 1. 후보 필터
  const candidates = input.proposals.filter((p) => p.activation >= cfg.minActivation);
  if (candidates.length === 0) {
    return { weights: {}, strategyAlloc: {}, reasons: ["no active strategies"] };
  }

  // proposal.family(runPool이 RegimeStrategy.family를 실어 보냄)를 우선 사용하고,
  // 없을 때만 이름 키워드 추론으로 폴백한다.
  const familyByStrategy: Record<string, StrategyFamily> = {};
  for (const p of candidates) familyByStrategy[p.strategy] = p.family ?? familyOf(p.strategy);

  // 2a. base 산출 — v1(활성도) 또는 v2(상관 다양화). returns 없으면 v1 폴백.
  let base: Record<string, number>;
  const wantsV2 = cfg.method === "riskparity" || cfg.method === "hrp";
  if (wantsV2 && input.strategyReturns) {
    base = diversifiedBase(candidates, input.strategyReturns, cfg, reasons);
  } else {
    if (wantsV2) reasons.push("v2 requested but no strategyReturns: v1 fallback");
    base = {};
    for (const p of candidates) base[p.strategy] = Math.max(0, p.activation);
  }

  // 2b. 정규화 Σ = 1 (먼저 정규화)
  const normalized = normalizeToOne(base);
  if (Object.keys(normalized).length === 0) {
    return { weights: {}, strategyAlloc: {}, reasons: [...reasons, "all strategies zero"] };
  }

  // 2c. 패밀리 예산 절대 상한 (정규화 후 적용, 차액은 현금 → cap 무력화 차단)
  const strategyAlloc = applyFamilyBudget(
    normalized,
    familyByStrategy,
    cfg.maxWeightPerFamily,
    reasons,
  );

  // 3. 종목 비중 합성 (같은 종목 자동 병합)
  const synthesized = synthesize(candidates, strategyAlloc);

  // 4. 포지션 가드 + 재정규화(Σ ≤ 1)
  const weights = guardAndRenormalize(synthesized, cfg.maxWeightPerSymbol, reasons);

  return { weights, strategyAlloc, reasons };
};
