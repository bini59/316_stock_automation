"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  ControlFlags,
  LiveSnapshot,
  RegimeLabel,
} from "@/lib/engine-types";
import { usd, pct, signedPct, num, dateTime, signClass } from "@/lib/format";
import { MetricCard } from "@/components/MetricCard";
import { ControlPanel } from "@/components/ControlPanel";
import { REGIME_LABELS, REGIME_COLORS, REGIME_KO } from "@/lib/regime";

interface LiveData {
  snapshot: LiveSnapshot;
  source: "mock" | "artifact";
}

export function LiveClient() {
  const [data, setData] = useState<LiveData | null>(null);
  const [flags, setFlags] = useState<ControlFlags | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [liveRes, ctrlRes] = await Promise.all([
        fetch("/api/live").then((r) => r.json()),
        fetch("/api/control").then((r) => r.json()),
      ]);
      setData(liveRes as LiveData);
      if (ctrlRes.flags) setFlags(ctrlRes.flags as ControlFlags);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000); // 폴링 (읽기 전용)
    return () => clearInterval(t);
  }, [load]);

  if (error) {
    return (
      <div>
        <h1 className="page-title">실거래 모니터링</h1>
        <div className="banner danger">읽기 오류: {error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <h1 className="page-title">실거래 모니터링</h1>
        <div className="empty">불러오는 중…</div>
      </div>
    );
  }

  const s = data.snapshot;

  return (
    <div data-testid="live-page">
      <div className="row" style={{ marginBottom: 8 }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          실거래 모니터링
        </h1>
        <span className={`mode-badge mode-${s.mode}`} data-testid="mode-badge">
          {s.mode}
        </span>
        {data.source === "mock" ? (
          <span className="badge warn" data-testid="mock-badge">
            MOCK 데이터 (토스 키 확보 전)
          </span>
        ) : null}
      </div>
      <p className="page-sub">
        엔진 LiveSnapshot 을 읽어 보여준다. 유일한 쓰기는 운영 제어(킬스위치 등).
        스냅샷 기준: {dateTime(s.asOf)}
      </p>

      <PnlRow snapshot={s} />

      <div className="grid grid-2">
        <Portfolio snapshot={s} />
        <div>
          <RegimePanel snapshot={s} />
          {flags ? <ControlPanel flags={flags} onChanged={setFlags} /> : null}
        </div>
      </div>

      <div className="grid grid-2">
        <OpenOrders snapshot={s} />
        <Decisions snapshot={s} />
      </div>
    </div>
  );
}

function PnlRow({ snapshot }: { snapshot: LiveSnapshot }) {
  const { account, pnl } = snapshot;
  return (
    <div className="grid grid-4" style={{ marginBottom: 18 }}>
      <MetricCard label="NAV (관리 순자산)" value={usd(account.nav)} big />
      <MetricCard label="현금" value={usd(account.cash)} />
      <MetricCard
        label="당일 손익"
        value={usd(pnl.day)}
        tone={signClass(pnl.day)}
      />
      <MetricCard
        label="누적 손익"
        value={usd(pnl.total)}
        tone={signClass(pnl.total)}
      />
    </div>
  );
}

function Portfolio({ snapshot }: { snapshot: LiveSnapshot }) {
  const { account, targetWeights } = snapshot;
  const holdings = Object.values(account.holdings);
  const nav = account.nav || 1;

  // 목표가 있거나 보유 중인 모든 심볼.
  const symbols = Array.from(
    new Set([...holdings.map((h) => h.symbol), ...Object.keys(targetWeights)]),
  ).sort();

  return (
    <div className="card">
      <h2 className="card-title">포트폴리오 — 목표 vs 현재 비중</h2>
      <table>
        <thead>
          <tr>
            <th>종목</th>
            <th className="num">수량</th>
            <th className="num">평가액</th>
            <th className="num">현재 비중</th>
            <th className="num">목표 비중</th>
            <th className="num">평가손익</th>
          </tr>
        </thead>
        <tbody>
          {symbols.map((sym) => {
            const h = account.holdings[sym];
            const mv = h?.marketValue ?? 0;
            const curW = mv / nav;
            const tgtW = targetWeights[sym] ?? 0;
            const upnl = h ? (h.marketValue - h.avgPrice * h.quantity) : 0;
            return (
              <tr key={sym}>
                <td className="mono">{sym}</td>
                <td className="num">{h ? num(h.quantity, 0) : "—"}</td>
                <td className="num">{usd(mv)}</td>
                <td className="num">{pct(curW)}</td>
                <td className="num">{pct(tgtW)}</td>
                <td className={`num ${signClass(upnl)}`}>{signedPct(
                  h && h.avgPrice * h.quantity !== 0
                    ? upnl / (h.avgPrice * h.quantity)
                    : 0,
                )}</td>
              </tr>
            );
          })}
          <tr>
            <td className="mono">CASH</td>
            <td className="num">—</td>
            <td className="num">{usd(account.cash)}</td>
            <td className="num">{pct(account.cash / nav)}</td>
            <td className="num">—</td>
            <td className="num">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function RegimePanel({ snapshot }: { snapshot: LiveSnapshot }) {
  const { regime, aggressiveness } = snapshot;
  return (
    <div className="card">
      <h2 className="card-title">국면 · 적극도</h2>
      <div className="row" style={{ marginBottom: 12 }}>
        <span
          className="badge"
          style={{
            background: REGIME_COLORS[regime.label],
            color: "#0b0f14",
            borderColor: "transparent",
            fontSize: 14,
          }}
        >
          {REGIME_KO[regime.label]} ({regime.label})
        </span>
        <span className="dim">확신도 {pct(regime.confidence)}</span>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 12 }}>
        <MetricCard label="적극도" value={num(aggressiveness, 2)} />
        <MetricCard label="추세 (trend)" value={num(regime.trend, 2)} />
        <MetricCard label="변동성" value={num(regime.volatility, 2)} />
      </div>

      <div className="label dim" style={{ marginBottom: 6 }}>
        membership (합=1)
      </div>
      <div style={{ display: "flex", height: 24, borderRadius: 6, overflow: "hidden" }}>
        {REGIME_LABELS.map((label: RegimeLabel) => {
          const frac = regime.membership[label] ?? 0;
          if (frac <= 0) return null;
          return (
            <div
              key={label}
              title={`${label} ${pct(frac)}`}
              style={{
                width: `${frac * 100}%`,
                background: REGIME_COLORS[label],
              }}
            />
          );
        })}
      </div>
      <div className="legend">
        {REGIME_LABELS.map((label) => (
          <span key={label}>
            <span className="swatch" style={{ background: REGIME_COLORS[label] }} />
            {REGIME_KO[label]} {pct(regime.membership[label] ?? 0)}
          </span>
        ))}
      </div>

      <p className="dim" style={{ fontSize: 12, marginTop: 12 }}>
        브레이크: 변동성 {regime.volatility >= 0.7 ? "⚠ 경계" : "정상"} ·
        추세품질 {num(regime.trendQuality, 2)}
      </p>
    </div>
  );
}

function OpenOrders({ snapshot }: { snapshot: LiveSnapshot }) {
  const orders = snapshot.openOrders;
  return (
    <div className="card">
      <h2 className="card-title">미체결 주문 ({orders.length})</h2>
      {orders.length === 0 ? (
        <p className="dim">미체결 주문 없음.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>종목</th>
              <th>방향</th>
              <th className="num">금액</th>
              <th>사유</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o, i) => (
              <tr key={o.clientOrderId ?? i}>
                <td className="mono">{o.symbol}</td>
                <td className={o.side === "BUY" ? "pos" : "neg"}>{o.side}</td>
                <td className="num">{usd(o.notional)}</td>
                <td className="dim">{o.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Decisions({ snapshot }: { snapshot: LiveSnapshot }) {
  const logs = snapshot.recentDecisions;
  return (
    <div className="card">
      <h2 className="card-title">최근 사이클 의사결정 로그</h2>
      {logs.length === 0 ? (
        <p className="dim">로그 없음.</p>
      ) : (
        <ul className="log-list">
          {logs.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
