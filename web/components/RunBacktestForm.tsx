/**
 * "새 백테스트 실행" 폼 — 엔진 run-backtest CLI 를 트리거하는 입력 표면.
 *
 * ★ 매매 로직 없음: 이 폼은 입력을 모아 POST /api/run 으로 보내고, 엔진이
 * 떨군 새 artifact id 를 콜백으로 알린다. 계산은 전부 엔진(src/).
 */
"use client";

import { useState } from "react";

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

export interface RunBacktestFormProps {
  /** 실행 성공 시 새 BacktestRun id 를 부모에 전달(목록 새로고침 + 선택) */
  onComplete: (id: string) => void;
}

export function RunBacktestForm({ onComplete }: RunBacktestFormProps) {
  const [universe, setUniverse] = useState<Set<string>>(
    () => new Set(SECTOR_ETFS),
  );
  const [from, setFrom] = useState("2018-01-01");
  const [to, setTo] = useState("2024-12-31");
  const [rebalance, setRebalance] = useState("20");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          universe: selected,
          from,
          to,
          rebalance: Number(rebalance),
        }),
      });
      const data: { id?: string; error?: string } = await res.json();
      if (!res.ok || !data.id) {
        throw new Error(data.error ?? `실행 실패 (HTTP ${res.status})`);
      }
      onComplete(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <form className="card" onSubmit={submit} data-testid="run-backtest-form">
      <h2 className="card-title">새 백테스트 실행</h2>
      <p className="dim" style={{ fontSize: 12, marginTop: -4 }}>
        엔진(헤드리스 CLI)을 트리거해 Yahoo 데이터를 페치하고 백테스트한다. 수초~
        수십초 걸릴 수 있다. UI는 결과 artifact 를 읽기만 한다.
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
                aria-label={`universe ${s}`}
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
              aria-label="from"
            />
          </label>
          <label className="field">
            <span className="label dim">종료일</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label="to"
            />
          </label>
          <label className="field">
            <span className="label dim">리밸런싱(일)</span>
            <input
              type="number"
              min={1}
              max={250}
              value={rebalance}
              onChange={(e) => setRebalance(e.target.value)}
              aria-label="rebalance"
              style={{ width: 90 }}
            />
          </label>
        </div>

        <div style={{ marginTop: 16 }}>
          <button type="submit" className="btn primary" data-testid="run-submit">
            {running ? "실행 중… (엔진 페치+백테스트)" : "백테스트 실행"}
          </button>
        </div>
      </fieldset>

      {running ? (
        <div className="banner" style={{ marginTop: 12 }} data-testid="run-progress">
          <span className="spinner" /> 엔진 실행 중 — Yahoo 데이터 페치 후 시뮬레이션
          중입니다. 페이지를 닫지 마세요.
        </div>
      ) : null}
      {error ? (
        <div className="banner danger" style={{ marginTop: 12 }} data-testid="run-error">
          실행 오류: {error}
        </div>
      ) : null}
    </form>
  );
}
