/**
 * 개발/E2E 용 샘플 BacktestRun 생성기.
 *
 * 엔진 산출물(BacktestRun)의 shape 를 충실히 흉내낸 대표 JSON 을 만든다.
 * regimePath·oosResult·gate·trades 를 모두 포함해 /backtest 의 모든 패널을 검증.
 *
 * 사용:
 *   node web/fixtures/generate.mjs                 # web/fixtures/sample-backtest-runs/ 에 출력
 *   node web/fixtures/generate.mjs <outDir>        # 임의 디렉터리에 출력 (예: artifacts/backtests)
 *
 * ⚠ 이건 mock 데이터다. 어떤 매매 로직도 없다 — 그럴듯한 곡선·거래·국면을 합성할 뿐.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const DAY = 86400000;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REGIMES = ["bull", "bear", "chop", "crisis"];

function softmax(vals) {
  const max = Math.max(...vals);
  const exps = vals.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function buildRun({ id, seed, from, days, splitFrac, drift, vol, triesIndex }) {
  const rng = mulberry32(seed);
  const to = from + days * DAY;
  const splitMs = from + Math.floor(days * splitFrac) * DAY;

  // equity curve (geometric random walk, cost-aware feel)
  const equityCurve = [];
  let eq = 100000;
  for (let i = 0; i < days; i++) {
    const shock = (rng() - 0.5) * vol;
    eq = eq * (1 + drift / days + shock);
    equityCurve.push(Math.round(eq * 100) / 100);
  }

  // trades — sample some entry/exit pairs
  const trades = [];
  let i = 5;
  while (i < days - 6) {
    const hold = 3 + Math.floor(rng() * 8);
    const entryTime = from + i * DAY;
    const exitTime = from + (i + hold) * DAY;
    const entryPrice = 100 + rng() * 50;
    const ret = (rng() - 0.45) * 0.08;
    const exitPrice = entryPrice * (1 + ret);
    const pnl = Math.round((exitPrice - entryPrice) * 100 * 100) / 100;
    trades.push({
      entryTime,
      exitTime,
      entryPrice: Math.round(entryPrice * 100) / 100,
      exitPrice: Math.round(exitPrice * 100) / 100,
      pnl,
    });
    i += hold + 2 + Math.floor(rng() * 4);
  }

  const splitIdx = Math.floor(days * splitFrac);
  const isCurve = equityCurve.slice(0, splitIdx);
  const oosCurve = equityCurve.slice(splitIdx);

  const mk = (curve, tr) => {
    const start = curve[0] ?? 1;
    const end = curve[curve.length - 1] ?? start;
    const totalReturn = end / start - 1;
    let peak = -Infinity;
    let mdd = 0;
    for (const v of curve) {
      peak = Math.max(peak, v);
      mdd = Math.max(mdd, (peak - v) / peak);
    }
    const wins = tr.filter((t) => t.pnl > 0).length;
    const sharpe = (totalReturn / (vol || 0.1)) * 1.5;
    return {
      totalReturn: Math.round(totalReturn * 10000) / 10000,
      sharpe: Math.round(sharpe * 100) / 100,
      maxDrawdown: Math.round(mdd * 10000) / 10000,
      winRate: tr.length ? Math.round((wins / tr.length) * 10000) / 10000 : 0,
      tradeCount: tr.length,
    };
  };

  const isTrades = trades.filter((t) => t.entryTime < splitMs);
  const oosTrades = trades.filter((t) => t.entryTime >= splitMs);

  const result = {
    equityCurve: isCurve.length ? isCurve : equityCurve,
    trades: isTrades,
    metrics: mk(isCurve.length ? isCurve : equityCurve, isTrades),
  };
  const oosResult = {
    equityCurve: oosCurve,
    trades: oosTrades,
    metrics: mk(oosCurve, oosTrades),
  };

  // regimePath — rebalance points (weekly)
  const regimePath = [];
  for (let d = 0; d < days; d += 5) {
    const t = from + d * DAY;
    const base = [
      drift > 0 ? 1.2 : -0.4, // bull
      drift < 0 ? 1.0 : -0.5, // bear
      0.3, // chop
      vol > 0.03 ? 0.8 : -1.0, // crisis
    ].map((b) => b + (rng() - 0.5));
    const mem = softmax(base);
    const membership = {
      bull: Math.round(mem[0] * 1000) / 1000,
      bear: Math.round(mem[1] * 1000) / 1000,
      chop: Math.round(mem[2] * 1000) / 1000,
      crisis: Math.round(mem[3] * 1000) / 1000,
    };
    let label = "bull";
    let best = -1;
    for (const r of REGIMES) {
      if (membership[r] > best) {
        best = membership[r];
        label = r;
      }
    }
    regimePath.push({
      timestamp: t,
      membership,
      label,
      aggressiveness: Math.round((0.3 + mem[0] * 0.6) * 100) / 100,
    });
  }

  // gate
  const reasons = [];
  const minSharpe = 1.0;
  const maxDD = 0.25;
  const minTrades = 20;
  if (result.metrics.sharpe < minSharpe)
    reasons.push(`샤프 ${result.metrics.sharpe} < 최소 ${minSharpe}`);
  if (result.metrics.maxDrawdown > maxDD)
    reasons.push(
      `MDD ${(result.metrics.maxDrawdown * 100).toFixed(1)}% > 허용 ${maxDD * 100}%`,
    );
  if (result.metrics.tradeCount < minTrades)
    reasons.push(
      `거래수 ${result.metrics.tradeCount} < 최소 ${minTrades} (표본 부족)`,
    );
  if (triesIndex >= 20)
    reasons.push(
      `다중검정 보정: 시도 #${triesIndex} — 기준 상향 필요(과최적화 의심)`,
    );

  return {
    id,
    createdAt: to,
    params: {
      lookback: 20 + (seed % 40),
      zEntry: Math.round((1.5 + (seed % 10) / 10) * 100) / 100,
      zExit: 0.5,
      maxLeverage: 1.0,
      rebalanceDays: 5,
    },
    universe: ["SPY", "QQQ", "IWM", "GLD", "TLT"],
    dateRange: { from, to },
    split: { inSampleEnd: splitMs },
    result,
    oosResult,
    gate: { passed: reasons.length === 0, reasons },
    triesIndex,
    regimePath,
  };
}

async function main() {
  const outDir =
    process.argv[2] ??
    path.resolve(path.dirname(new URL(import.meta.url).pathname), "sample-backtest-runs");

  const from = Date.UTC(2021, 0, 1);

  const runs = [
    buildRun({
      id: "run-momentum-bull-001",
      seed: 7,
      from,
      days: 720,
      splitFrac: 0.7,
      drift: 0.55,
      vol: 0.018,
      triesIndex: 3,
    }),
    buildRun({
      id: "run-meanrev-chop-014",
      seed: 23,
      from,
      days: 720,
      splitFrac: 0.7,
      drift: 0.12,
      vol: 0.028,
      triesIndex: 14,
    }),
    buildRun({
      id: "run-overfit-suspect-087",
      seed: 91,
      from,
      days: 720,
      splitFrac: 0.7,
      drift: 0.9,
      vol: 0.045,
      triesIndex: 87,
    }),
  ];

  await fs.mkdir(outDir, { recursive: true });
  for (const r of runs) {
    const file = path.join(outDir, `${r.id}.json`);
    await fs.writeFile(file, JSON.stringify(r, null, 2), "utf-8");
    console.log(`wrote ${file}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
