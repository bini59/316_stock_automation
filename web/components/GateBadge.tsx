/** 게이트 합격/불합격 배지 + 사유 (GateResult). */
import type { GateResult } from "@/lib/engine-types";

export function GateBadge({ gate }: { gate: GateResult }) {
  return (
    <div>
      <span className={`badge ${gate.passed ? "pass" : "fail"}`}>
        {gate.passed ? "게이트 통과" : "게이트 불합격"}
      </span>
      {gate.reasons.length > 0 ? (
        <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
          {gate.reasons.map((r, i) => (
            <li key={i} className="dim" style={{ fontSize: 12 }}>
              {r}
            </li>
          ))}
        </ul>
      ) : (
        <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>
          기록된 사유 없음.
        </p>
      )}
    </div>
  );
}
