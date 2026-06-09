/** 국면 라벨 표시 메타 (색·한글 라벨). 순수 매핑, 클라이언트 공용. */
import type { RegimeLabel } from "./engine-types";

export const REGIME_LABELS: readonly RegimeLabel[] = [
  "bull",
  "bear",
  "chop",
  "crisis",
];

// 의미는 유지하되 Stripi 그래디언트 스톱(인디고/루비/레몬/마젠타·네이비)으로 조화.
export const REGIME_COLORS: Record<RegimeLabel, string> = {
  bull: "#533afd", // 상승 — 인디고 primary
  bear: "#ea2261", // 하락 — 루비
  chop: "#9b6829", // 횡보 — 레몬(sherbet)
  crisis: "#1c1e54", // 위기 — brand-dark navy
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
