/**
 * 표시용 순수 포매터 (클라이언트·서버 공용, side-effect 0).
 * 숫자→문자 변환만. 어떤 매매·신호 로직도 여기 없음.
 */

export function pct(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export function signedPct(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${(x * 100).toFixed(digits)}%`;
}

export function num(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function usd(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function int(x: number): string {
  if (!Number.isFinite(x)) return "—";
  return Math.round(x).toLocaleString("en-US");
}

/** epoch(ms) → YYYY-MM-DD */
export function dateOnly(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toISOString().slice(0, 10);
}

/** epoch(ms) → YYYY-MM-DD HH:mm:ss (UTC) */
export function dateTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ") + " UTC";
}

export function signClass(x: number): "pos" | "neg" | "zero" {
  if (x > 0) return "pos";
  if (x < 0) return "neg";
  return "zero";
}
