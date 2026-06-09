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

/** 미국 대표 대형주 예시(직접 입력칸 빠른 채우기). 개별주는 생존편향 주의. */
const MEGACAP_EXAMPLE = "SPY, QQQ, AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA, AVGO, JPM, V, UNH";

const TICKER_RE = /^[A-Z0-9^.\-]+$/;

/** 쉼표·공백 구분 → 대문자·검증·중복 제거 */
function parseTickers(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw.split(/[,\s]+/)) {
    const sym = t.trim().toUpperCase();
    if (sym && TICKER_RE.test(sym) && !seen.has(sym)) {
      seen.add(sym);
      out.push(sym);
    }
  }
  return out;
}

export interface RunBacktestFormProps {
  /** 실행 성공 시 새 BacktestRun id 를 부모에 전달(목록 새로고침 + 선택) */
  onComplete: (id: string) => void;
}

export function RunBacktestForm({ onComplete }: RunBacktestFormProps) {
  const [universe, setUniverse] = useState<Set<string>>(
    () => new Set(SECTOR_ETFS),
  );
  const [customTickers, setCustomTickers] = useState("");
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

  // 최종 유니버스 = 체크된 섹터 ETF ∪ 직접 입력 티커
  const custom = parseTickers(customTickers);
  const finalUniverse = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of [...SECTOR_ETFS.filter((s) => universe.has(s)), ...custom]) {
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
    return out;
  })();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const selected = finalUniverse;
    if (selected.length === 0) {
      setError("유니버스를 최소 1개 선택하거나 입력하세요(섹터 ETF 체크 또는 직접 입력).");
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

        <div className="label dim" style={{ margin: "14px 0 6px" }}>
          직접 입력 (쉼표/공백 구분, 미국 티커 — 예: SPY, QQQ, AAPL)
        </div>
        <input
          type="text"
          value={customTickers}
          onChange={(e) => setCustomTickers(e.target.value)}
          placeholder="SPY, QQQ, AAPL, MSFT, NVDA …"
          aria-label="custom tickers"
          style={{ width: "100%" }}
        />
        <div className="row" style={{ gap: 10, marginTop: 6, alignItems: "center" }}>
          <button
            type="button"
            className="btn"
            onClick={() => setCustomTickers(MEGACAP_EXAMPLE)}
            style={{ fontSize: 12 }}
          >
            대형주 예시 채우기
          </button>
          {customTickers.trim() ? (
            <button
              type="button"
              className="btn"
              onClick={() => setCustomTickers("")}
              style={{ fontSize: 12 }}
            >
              직접 입력 지우기
            </button>
          ) : null}
        </div>
        <p className="dim" style={{ fontSize: 11, marginTop: 6 }}>
          ⚠ 개별주(오늘의 승자)로 과거를 돌리면 생존편향이 낀다 — 결과가 부풀려질 수
          있으니 OOS·게이트로 판단하세요. 편향 적은 출발점은 섹터/지수 ETF(SPY·QQQ).
        </p>
        <div className="label dim" style={{ marginTop: 8 }} data-testid="effective-universe">
          적용 유니버스({finalUniverse.length}): <span className="mono">{finalUniverse.join(", ") || "—"}</span>
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
