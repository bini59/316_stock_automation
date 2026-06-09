"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { BacktestRun } from "@/lib/engine-types";
import { pct, signedPct, num, int, dateOnly } from "@/lib/format";
import { MetricCard } from "@/components/MetricCard";
import { GateBadge } from "@/components/GateBadge";
import { TriesCounter } from "@/components/TriesCounter";
import { SampleMetrics } from "@/components/SampleMetrics";
import { RegimeTimeline } from "@/components/RegimeTimeline";
import { RunCompare } from "@/components/RunCompare";

// lightweight-charts 는 브라우저 전용 → SSR 비활성.
const EquityChart = dynamic(
  () => import("@/components/EquityChart").then((m) => m.EquityChart),
  { ssr: false, loading: () => <div className="dim">차트 로딩…</div> },
);

export function BacktestClient() {
  const [runs, setRuns] = useState<BacktestRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    fetch("/api/backtests")
      .then((r) => r.json())
      .then((data: { runs?: BacktestRun[]; error?: string }) => {
        if (!alive) return;
        if (data.error) setError(data.error);
        const list = data.runs ?? [];
        setRuns(list);
        if (list.length > 0 && list[0]) setSelectedId(list[0].id);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const selected = useMemo(
    () => runs?.find((r) => r.id === selectedId) ?? null,
    [runs, selectedId],
  );

  const compareRuns = useMemo(
    () => (runs ?? []).filter((r) => compareIds.has(r.id)),
    [runs, compareIds],
  );

  function toggleCompare(id: string) {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div data-testid="backtest-page">
      <h1 className="page-title">백테스트 확인·보정</h1>
      <p className="page-sub">
        엔진 산출물(BacktestRun)을 읽어 보여준다. 여기서 매매를 계산하지 않는다 —
        보정 규율만 시각적으로 강제한다.
      </p>

      {error ? (
        <div className="banner danger">읽기 오류: {error}</div>
      ) : null}

      {runs === null ? (
        <div className="empty">불러오는 중…</div>
      ) : runs.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <RunPicker
            runs={runs}
            selectedId={selectedId}
            onSelect={setSelectedId}
            compareIds={compareIds}
            onToggleCompare={toggleCompare}
          />
          {selected ? <RunDetail run={selected} /> : null}

          <div className="card">
            <h2 className="card-title">런 비교 (params diff + 성과 diff)</h2>
            <RunCompare runs={compareRuns} />
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <p>표시할 BacktestRun 산출물이 없습니다.</p>
      <p>
        프로젝트 루트에서 엔진으로 백테스트를 실행하거나
        <br />
        <code>artifacts/backtests/&lt;id&gt;.json</code> 에 BacktestRun JSON 을
        떨구세요.
      </p>
      <p className="dim" style={{ fontSize: 12 }}>
        개발용 샘플: <code>web/fixtures/sample-backtest-runs/*.json</code> 를{" "}
        <code>artifacts/backtests/</code> 로 복사.
      </p>
    </div>
  );
}

function RunPicker({
  runs,
  selectedId,
  onSelect,
  compareIds,
  onToggleCompare,
}: {
  runs: BacktestRun[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  compareIds: Set<string>;
  onToggleCompare: (id: string) => void;
}) {
  return (
    <div className="card">
      <h2 className="card-title">런 선택 ({runs.length}개)</h2>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>보기</th>
              <th>비교</th>
              <th>ID</th>
              <th>생성일</th>
              <th className="num">샤프(IS)</th>
              <th className="num">MDD(IS)</th>
              <th>게이트</th>
              <th className="num">시도#</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>
                  <input
                    type="radio"
                    name="selected-run"
                    checked={selectedId === r.id}
                    onChange={() => onSelect(r.id)}
                    aria-label={`select ${r.id}`}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={compareIds.has(r.id)}
                    onChange={() => onToggleCompare(r.id)}
                    aria-label={`compare ${r.id}`}
                  />
                </td>
                <td className="mono">{r.id}</td>
                <td>{dateOnly(r.createdAt)}</td>
                <td className="num">{num(r.result.metrics.sharpe, 2)}</td>
                <td className="num">{pct(r.result.metrics.maxDrawdown)}</td>
                <td>
                  <span className={`badge ${r.gate.passed ? "pass" : "fail"}`}>
                    {r.gate.passed ? "통과" : "불합격"}
                  </span>
                </td>
                <td className="num">#{r.triesIndex}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RunDetail({ run }: { run: BacktestRun }) {
  const m = run.result.metrics;
  return (
    <>
      <div className="banner warn">
        ⚠ <strong>보정 규율:</strong> 튜닝은 <strong>in-sample(파랑)</strong>{" "}
        결과로만 한다. out-of-sample(노랑)을 보며 파라미터를 고치면 그 순간
        OOS는 in-sample이 되어 검증 가치를 잃는다.
      </div>

      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <MetricCard
          label="총수익 (IS)"
          value={signedPct(m.totalReturn)}
          tone={m.totalReturn >= 0 ? "pos" : "neg"}
        />
        <MetricCard label="샤프 (IS)" value={num(m.sharpe, 2)} />
        <MetricCard
          label="최대낙폭 (IS)"
          value={pct(m.maxDrawdown)}
          tone="neg"
        />
        <MetricCard label="승률 (IS)" value={pct(m.winRate)} />
        <MetricCard label="거래수 (IS)" value={int(m.tradeCount)} />
      </div>

      <div className="card">
        <h2 className="card-title">
          Equity Curve — {dateOnly(run.dateRange.from)} ~{" "}
          {dateOnly(run.dateRange.to)} (OOS 경계{" "}
          {dateOnly(run.split.inSampleEnd)})
        </h2>
        <EquityChart run={run} />
        {run.regimePath && run.regimePath.length > 0 ? (
          <div style={{ marginTop: 16 }}>
            <h3 className="card-title" style={{ marginBottom: 8 }}>
              국면 타임라인 (membership 띠)
            </h3>
            <RegimeTimeline path={run.regimePath} />
          </div>
        ) : null}
      </div>

      <div className="grid grid-3">
        <div className="card">
          <h2 className="card-title">in/out-of-sample 지표</h2>
          <SampleMetrics inSample={run.result} oos={run.oosResult} />
        </div>
        <div className="card">
          <h2 className="card-title">합격 게이트</h2>
          <GateBadge gate={run.gate} />
        </div>
        <div className="card">
          <h2 className="card-title">다중검정</h2>
          <TriesCounter triesIndex={run.triesIndex} />
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">파라미터 & 유니버스 (재현용)</h2>
        <div className="row" style={{ alignItems: "flex-start", gap: 32 }}>
          <div>
            <table>
              <thead>
                <tr>
                  <th>파라미터</th>
                  <th className="num">값</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(run.params).map(([k, v]) => (
                  <tr key={k}>
                    <td className="mono">{k}</td>
                    <td className="num">{num(v, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="label dim" style={{ marginBottom: 6 }}>
              유니버스 ({run.universe.length})
            </div>
            <div className="row">
              {run.universe.map((s) => (
                <span key={s} className="badge mono">
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
