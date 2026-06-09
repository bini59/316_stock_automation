/** 지표 카드 — 재사용. 순수 표시. */
interface Props {
  label: string;
  value: string;
  hint?: string;
  tone?: "pos" | "neg" | "zero" | "default";
  big?: boolean;
}

export function MetricCard({ label, value, hint, tone = "default", big }: Props) {
  const valueClass = [
    "value",
    big ? "big" : "",
    tone === "default" ? "" : tone,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div className={valueClass}>{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}
