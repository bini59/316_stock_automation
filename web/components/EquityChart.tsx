"use client";

/**
 * Equity curve (lightweight-charts) + in/out-of-sample 시각 분리 + 거래 마커.
 *
 * - equityCurve 는 number[] (타임스탬프 없음) → dateRange 로 인덱스를 날짜에 매핑.
 * - split.inSampleEnd 이후 구간을 별도 색 라인 + 음영으로 OOS 표시.
 *   "OOS 보며 튜닝 금지" 규율을 시각적으로 강제.
 * - trades 의 entry/exit 을 마커로.
 */
import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type Time,
  type SeriesMarker,
} from "lightweight-charts";
import type { BacktestRun } from "@/lib/engine-types";

interface Props {
  run: BacktestRun;
  height?: number;
}

/** 인덱스 i 를 dateRange 안의 날짜(epoch sec)로 균등 매핑. */
function indexToTime(
  i: number,
  count: number,
  from: number,
  to: number,
): Time {
  const span = Math.max(to - from, 1);
  const frac = count <= 1 ? 0 : i / (count - 1);
  const ms = from + frac * span;
  return Math.floor(ms / 1000) as Time;
}

export function EquityChart({ run, height = 360 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9aa7b4",
      },
      grid: {
        vertLines: { color: "#2a3340" },
        horzLines: { color: "#2a3340" },
      },
      rightPriceScale: { borderColor: "#2a3340" },
      timeScale: { borderColor: "#2a3340", timeVisible: false },
      crosshair: { mode: 1 },
      autoSize: true,
    });
    chartRef.current = chart;

    const curve = run.result.equityCurve;
    const n = curve.length;
    const { from, to } = run.dateRange;
    const splitMs = run.split?.inSampleEnd ?? to;

    // 인덱스가 in-sample 경계를 넘는 지점.
    let splitIndex = n;
    for (let i = 0; i < n; i++) {
      const tMs = (indexToTime(i, n, from, to) as number) * 1000;
      if (tMs > splitMs) {
        splitIndex = i;
        break;
      }
    }

    const toPoint = (v: number, i: number) => ({
      time: indexToTime(i, n, from, to),
      value: v,
    });

    // in-sample 라인 (밝은 파랑)
    const inSeries = chart.addLineSeries({
      color: "#3b82f6",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    inSeries.setData(
      curve.slice(0, Math.min(splitIndex + 1, n)).map((v, i) => toPoint(v, i)),
    );

    // out-of-sample 라인 (경고색 amber) — 보는 순간 in-sample 이 된다.
    if (splitIndex < n) {
      const outSeries = chart.addLineSeries({
        color: "#eab308",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      outSeries.setData(
        curve
          .slice(splitIndex)
          .map((v, j) => toPoint(v, splitIndex + j)),
      );

      // OOS 경계 수직선
      inSeries.createPriceLine({
        price: curve[splitIndex] ?? curve[n - 1] ?? 0,
        color: "#eab308",
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: false,
        title: "OOS 시작",
      });
    }

    // 거래 마커 — entry/exit, pnl 부호로 색.
    const markers: SeriesMarker<Time>[] = [];
    for (const t of run.result.trades) {
      const entryT = Math.floor(t.entryTime / 1000) as Time;
      const exitT = Math.floor(t.exitTime / 1000) as Time;
      markers.push({
        time: entryT,
        position: "belowBar",
        color: "#60a5fa",
        shape: "arrowUp",
        text: "진입",
      });
      markers.push({
        time: exitT,
        position: "aboveBar",
        color: t.pnl >= 0 ? "#22c55e" : "#ef4444",
        shape: "arrowDown",
        text: t.pnl >= 0 ? "익절" : "손절",
      });
    }
    // 마커는 시간 오름차순이어야 한다.
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    if (markers.length > 0) inSeries.setMarkers(markers);

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [run, height]);

  return (
    <div>
      <div ref={containerRef} style={{ width: "100%", height }} />
      <div className="legend">
        <span>
          <span className="swatch" style={{ background: "#3b82f6" }} />
          In-sample (튜닝 허용)
        </span>
        <span>
          <span className="swatch" style={{ background: "#eab308" }} />
          Out-of-sample (보지만 말 것)
        </span>
        <span>
          <span className="swatch" style={{ background: "#60a5fa" }} />
          진입
        </span>
        <span>
          <span className="swatch" style={{ background: "#22c55e" }} />
          익절 / <span className="swatch" style={{ background: "#ef4444" }} />{" "}
          손절
        </span>
      </div>
    </div>
  );
}
