"use client";

/**
 * 국면 타임라인 — regimePath 의 membership 을 시간축 위 stacked 띠로.
 * 성과(equity) 위/아래에 겹쳐 "이 수익이 어느 국면에서 났나"를 본다.
 *
 * 순수 SVG (차트 라이브러리 불필요). membership 합=1 을 세로로 쌓는다.
 */
import type { RegimeTimelinePoint } from "@/lib/engine-types";
import { REGIME_LABELS, REGIME_COLORS, REGIME_KO } from "@/lib/regime";

interface Props {
  path: readonly RegimeTimelinePoint[];
  height?: number;
}

export function RegimeTimeline({ path, height = 56 }: Props) {
  if (path.length === 0) {
    return (
      <p className="dim" style={{ fontSize: 12 }}>
        regimePath 없음 — 이 런에는 국면 타임라인 데이터가 포함되지 않았습니다.
      </p>
    );
  }

  const n = path.length;
  const colW = 100 / n; // % 단위

  return (
    <div>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        style={{ display: "block", borderRadius: 6, overflow: "hidden" }}
      >
        {path.map((pt, i) => {
          let y = 0;
          return (
            <g key={i}>
              {REGIME_LABELS.map((label) => {
                const frac = pt.membership[label] ?? 0;
                const h = frac * height;
                const rect = (
                  <rect
                    key={label}
                    x={i * colW}
                    y={y}
                    width={colW + 0.3}
                    height={h}
                    fill={REGIME_COLORS[label]}
                    opacity={0.85}
                  />
                );
                y += h;
                return rect;
              })}
            </g>
          );
        })}
      </svg>
      <div className="legend">
        {REGIME_LABELS.map((label) => (
          <span key={label}>
            <span
              className="swatch"
              style={{ background: REGIME_COLORS[label] }}
            />
            {REGIME_KO[label]} ({label})
          </span>
        ))}
      </div>
    </div>
  );
}
