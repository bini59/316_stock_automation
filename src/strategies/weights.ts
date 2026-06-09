/**
 * 전략-내부 비중 헬퍼 — 전부 순수 함수, look-ahead 무관(입력 스칼라만 다룸).
 *
 * 규약: 반환되는 weights는 항상 합 ≤ 1 (나머지는 전략-내 현금).
 * 음수 비중 없음(롱-온리). 빈 후보면 {} (전량 현금).
 */

/** 후보 심볼들에 동일가중. cap으로 합이 cap을 넘지 않게 정규화. */
export function equalWeight(symbols: readonly string[], cap = 1): Record<string, number> {
  const valid = symbols.filter((s) => s.length > 0);
  if (valid.length === 0) return {};
  const w = cap / valid.length;
  const out: Record<string, number> = {};
  for (const s of valid) out[s] = w;
  return out;
}

/**
 * 역변동성 가중: 변동성이 낮은 종목에 더 큰 비중. vol<=0 종목은 제외.
 * 합이 cap이 되도록 정규화. 유효 종목 없으면 {}.
 */
export function inverseVolWeight(
  vols: Readonly<Record<string, number>>,
  cap = 1,
): Record<string, number> {
  const inv: Record<string, number> = {};
  let total = 0;
  for (const [sym, v] of Object.entries(vols)) {
    if (Number.isFinite(v) && v > 0) {
      const iv = 1 / v;
      inv[sym] = iv;
      total += iv;
    }
  }
  if (total <= 0) return {};
  const out: Record<string, number> = {};
  for (const [sym, iv] of Object.entries(inv)) out[sym] = (iv / total) * cap;
  return out;
}

/**
 * 점수 비례 가중: score가 큰 종목에 더 큰 비중. score<=0 종목은 제외.
 * 합이 cap이 되도록 정규화.
 */
export function scoreWeight(
  scores: Readonly<Record<string, number>>,
  cap = 1,
): Record<string, number> {
  const pos: Record<string, number> = {};
  let total = 0;
  for (const [sym, s] of Object.entries(scores)) {
    if (Number.isFinite(s) && s > 0) {
      pos[sym] = s;
      total += s;
    }
  }
  if (total <= 0) return {};
  const out: Record<string, number> = {};
  for (const [sym, s] of Object.entries(pos)) out[sym] = (s / total) * cap;
  return out;
}

/** 합이 cap을 넘으면 cap으로 비례 축소. 넘지 않으면 그대로(현금 보존). */
export function capSum(weights: Record<string, number>, cap = 1): Record<string, number> {
  const sum = Object.values(weights).reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (sum <= cap || sum <= 0) return { ...weights };
  const scale = cap / sum;
  const out: Record<string, number> = {};
  for (const [sym, w] of Object.entries(weights)) out[sym] = w * scale;
  return out;
}

/** weights의 합(음수 무시). */
export function sumWeights(weights: Readonly<Record<string, number>>): number {
  return Object.values(weights).reduce((a, b) => a + (b > 0 ? b : 0), 0);
}
