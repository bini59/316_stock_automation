/** 국면 라벨 표시 메타 (색·한글 라벨). 순수 매핑, 클라이언트 공용. */
import type { RegimeLabel } from "./engine-types";

export const REGIME_LABELS: readonly RegimeLabel[] = [
  "bull",
  "bear",
  "chop",
  "crisis",
];

export const REGIME_COLORS: Record<RegimeLabel, string> = {
  bull: "#22c55e", // 상승 — green
  bear: "#ef4444", // 하락 — red
  chop: "#eab308", // 횡보 — amber
  crisis: "#7c3aed", // 위기 — violet
};

export const REGIME_KO: Record<RegimeLabel, string> = {
  bull: "상승",
  bear: "하락",
  chop: "횡보",
  crisis: "위기",
};

export function regimeColor(label: RegimeLabel): string {
  return REGIME_COLORS[label] ?? "#64748b";
}
