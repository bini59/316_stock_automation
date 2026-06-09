/**
 * 튜닝 실행 + 결과 비교 테이블.
 *
 * ★ 절대 원칙: 파라미터 탐색·OOS 시험은 엔진(src/pipeline/tune.ts)에서만.
 * 이 컴포넌트는 POST /api/tune 으로 트리거하고 TuningArtifact 를 읽어 그린다.
 *
 * ★ 보정 규율 UI:
 *  - in-sample 성과는 "의미 없음" 명시. OOS·게이트로만 판단.
 *  - 다중검정 triesIndex 노출(운으로 좋은 조합 자각).
 *  - 과최적화 격차(in-OOS 샤프) 강조 — 크면 경고.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import type { TuningArtifact } from "@/lib/engine-types";
import { pct, signedPct, num } from "@/lib/format";

const SECTOR_ETFS = [
  "XLK",
  "XLF",
  "XLV",
  "XLE",
  "XLI",
  "XLY",
  "XLP",
  "XLU",
  "XLB",
] as const;

/** 과최적화 격차 경고 임계 (in-sample 샤프 − OOS 샤프). */
const OVERFIT_WARN = 0.5;

export function TuningPanel() {
  const [universe, setUniverse] = useState<Set<string>>(
    () => new Set(SECTOR_ETFS),
  );
  const [from, setFrom] = useState("2018-01-01");
  const [to, setTo] = useState("2024-12-31");
  const [ratio, setRatio] = useState("0.7");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TuningArtifact | null>(null);

  function toggle(sym: string) {
    setUniverse((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym);
      else next.add(sym);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const selected = SECTOR_ETFS.filter((s) => universe.has(s));
    if (selected.length === 0) {
      setError("유니버스에서 최소 1개 섹터 ETF를 선택하세요.");
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/tune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          universe: selected,
          from,
          to,
          ratio: Number(ratio),
        }),
      });
      const data: { id?: string; error?: string } = await res.json();
      if (!res.ok || !data.id) {
        throw new Error(data.error ?? `튜닝 실패 (HTTP ${res.status})`);
      }
      // 산출된 TuningArtifact 를 읽어와 비교 테이블 렌더
      const got = await fetch(`/api/tuning/${encodeURIComponent(data.id)}`);
      const tuning: { item?: TuningArtifact; error?: string } = await got.json();
      if (!got.ok || !tuning.item) {
        throw new Error(tuning.error ?? "튜닝 결과를 읽지 못했습니다.");
      }
      setResult(tuning.item);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div data-testid="tuning-panel">
      <form className="card" onSubmit={submit} data-testid="tune-form">
        <h2 className="card-title">튜닝 실행 (in-sample 탐색 → OOS 단일 시험)</h2>
        <p className="dim" style={{ fontSize: 12, marginTop: -4 }}>
          엔진이 in-sample 구간에서 파라미터 그리드를 탐색하고, 선택한 파라미터를
          out-of-sample 에서 <strong>딱 한 번</strong> 시험한다. 웹은 결과만 읽는다.
        </p>

        <fieldset disabled={running} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="label dim" style={{ margin: "10px 0 6px" }}>
            유니버스 (섹터 ETF)
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
            {SECTOR_ETFS.map((s) => (
              <label key={s} className="row" style={{ gap: 4, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={universe.has(s)}
                  onChange={() => toggle(s)}
                  aria-label={`tune universe ${s}`}
                />
                <span className="mono">{s}</span>
              </label>
            ))}
          </div>

          <div className="row" style={{ gap: 20, marginTop: 14, flexWrap: "wrap" }}>
            <label className="field">
              <span className="label dim">시작일</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="tune from"
              />
            </label>
            <label className="field">
              <span className="label dim">종료일</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label="tune to"
              />
            </label>
            <label className="field">
              <span className="label dim">in-sample 비율 (0~1)</span>
              <input
                type="number"
                min={0.1}
                max={0.9}
                step={0.05}
                value={ratio}
                onChange={(e) => setRatio(e.target.value)}
                aria-label="ratio"
                style={{ width: 90 }}
              />
            </label>
          </div>

          <div style={{ marginTop: 16 }}>
            <button type="submit" className="btn primary" data-testid="tune-submit">
              {running ? "튜닝 실행 중… (그리드 탐색)" : "튜닝 실행"}
            </button>
          </div>
        </fieldset>

        {running ? (
          <div className="banner" style={{ marginTop: 12 }} data-testid="tune-progress">
            <span className="spinner" /> 엔진이 파라미터 그리드를 in-sample 에서
            탐색 중입니다. 조합 수에 따라 수십초 이상 걸릴 수 있습니다.
          </div>
        ) : null}
        {error ? (
          <div className="banner danger" style={{ marginTop: 12 }} data-testid="tune-error">
            튜닝 오류: {error}
          </div>
        ) : null}
      </form>

      {result ? <TuningResultTable artifact={result} /> : null}
    </div>
  );
}

function TuningResultTable({ artifact }: { artifact: TuningArtifact }) {
  const r = artifact.result;
  const overfit = r.overfitGap;
  const overfitBad = overfit > OVERFIT_WARN;

  return (
    <div data-testid="tuning-result">
      <div className="banner warn" style={{ marginTop: 18 }}>
        ⚠ <strong>판단 규율:</strong> <strong>in-sample 성과는 의미 없다</strong>
        (탐색에 쓰인 구간이므로 좋게 나오는 게 당연). 채택 여부는 반드시{" "}
        <strong>out-of-sample(OOS)</strong> 성과와 <strong>OOS 게이트</strong>로만
        판단한다.
      </div>

      <div className="card">
        <h2 className="card-title">비교 — SPY 매수후보유 vs 기본 vs 튜닝</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>지표</th>
                <th className="num">SPY B&amp;H (전체)</th>
                <th className="num">기본 (전체)</th>
                <th className="num">기본 (IS)</th>
                <th className="num" style={{ color: "#c4123f" }}>
                  기본 (OOS)
                </th>
                <th className="num">튜닝 (전체)</th>
                <th className="num">튜닝 (IS)</th>
                <th className="num" style={{ color: "#c4123f" }}>
                  튜닝 (OOS)
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>총수익</td>
                <td className="num">{signedPct(r.buyHold.totalReturn)}</td>
                <td className="num">{signedPct(r.baseline.full.totalReturn)}</td>
                <td className="num">{signedPct(r.baseline.inSample.totalReturn)}</td>
                <td className="num" style={{ color: "#c4123f" }}>
                  {signedPct(r.baseline.oos.totalReturn)}
                </td>
                <td className="num">{signedPct(r.tuned.full.totalReturn)}</td>
                <td className="num dim">{signedPct(r.tuned.inSample.totalReturn)}</td>
                <td className="num" style={{ color: "#c4123f" }}>
                  {signedPct(r.tuned.oos.totalReturn)}
                </td>
              </tr>
              <tr>
                <td>샤프</td>
                <td className="num">{num(r.buyHold.sharpe, 2)}</td>
                <td className="num">{num(r.baseline.full.sharpe, 2)}</td>
                <td className="num">{num(r.baseline.inSample.sharpe, 2)}</td>
                <td className="num" style={{ color: "#c4123f" }}>
                  {num(r.baseline.oos.sharpe, 2)}
                </td>
                <td className="num">{num(r.tuned.full.sharpe, 2)}</td>
                <td className="num dim">{num(r.tuned.inSample.sharpe, 2)}</td>
                <td className="num" style={{ color: "#c4123f" }}>
                  {num(r.tuned.oos.sharpe, 2)}
                </td>
              </tr>
              <tr>
                <td>최대낙폭(MDD)</td>
                <td className="num">{pct(r.buyHold.maxDrawdown)}</td>
                <td className="num">{pct(r.baseline.full.maxDrawdown)}</td>
                <td className="num">{pct(r.baseline.inSample.maxDrawdown)}</td>
                <td className="num" style={{ color: "#c4123f" }}>
                  {pct(r.baseline.oos.maxDrawdown)}
                </td>
                <td className="num">{pct(r.tuned.full.maxDrawdown)}</td>
                <td className="num dim">{pct(r.tuned.inSample.maxDrawdown)}</td>
                <td className="num" style={{ color: "#c4123f" }}>
                  {pct(r.tuned.oos.maxDrawdown)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-3">
        <div className="card">
          <h2 className="card-title">최적 파라미터 (in-sample 선택)</h2>
          <table>
            <tbody>
              {Object.entries(r.best).map(([k, v]) => (
                <tr key={k}>
                  <td className="mono">{k}</td>
                  <td className="num">{num(v as number, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2 className="card-title">다중검정</h2>
          <div className="metric-value" data-testid="tune-tries">
            {r.triesIndex}
          </div>
          <p className="dim" style={{ fontSize: 12 }}>
            시도한 조합 수. 많을수록 운으로 좋은 게 섞일 확률↑ — 게이트는 이
            triesIndex 로 엄격해진다.
          </p>
        </div>

        <div className="card">
          <h2 className="card-title">OOS 게이트 (다중검정 보정)</h2>
          <span
            className={`badge ${r.gate.passed ? "pass" : "fail"}`}
            data-testid="tune-gate"
          >
            {r.gate.passed ? "OOS 합격" : "OOS 불합격"}
          </span>
          {r.gate.reasons.length > 0 ? (
            <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
              {r.gate.reasons.map((reason, i) => (
                <li key={i} className="dim" style={{ fontSize: 12 }}>
                  {reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div
        className={`card ${overfitBad ? "danger-card" : ""}`}
        data-testid="overfit-gap"
      >
        <h2 className="card-title">과최적화 격차 (in-sample 샤프 − OOS 샤프)</h2>
        <div className="row" style={{ alignItems: "baseline", gap: 16 }}>
          <div
            className="metric-value"
            style={{ color: overfitBad ? "#c4123f" : undefined }}
          >
            {num(overfit, 2)}
          </div>
          <div className="dim" style={{ fontSize: 13 }}>
            IS 샤프 {num(r.tuned.inSample.sharpe, 2)} → OOS 샤프{" "}
            {num(r.tuned.oos.sharpe, 2)}
          </div>
        </div>
        {overfitBad ? (
          <div className="banner danger" style={{ marginTop: 10 }}>
            ⚠ 과최적화 의심: in-sample 대비 OOS 샤프가 {num(overfit, 2)} 만큼
            급락했습니다 (임계 {OVERFIT_WARN}). 이 파라미터는 과거에 과적합됐을
            가능성이 높습니다 — 채택하지 마세요.
          </div>
        ) : (
          <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>
            격차가 작을수록 일반화가 잘 된 것. 임계 {OVERFIT_WARN} 이하 양호.
          </p>
        )}
      </div>

      <div className="card">
        <p>
          최적 파라미터의 상세(equity curve·국면 타임라인)는 BacktestRun{" "}
          <code className="mono">{artifact.bestRunId}</code> 에 있습니다.{" "}
          <Link
            href={`/backtest?run=${encodeURIComponent(artifact.bestRunId)}`}
            data-testid="bestrun-link"
          >
            상세 보기 →
          </Link>
        </p>
      </div>
    </div>
  );
}
