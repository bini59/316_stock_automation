/**
 * in-sample vs out-of-sample 지표 분리 표.
 * OOS 열에 경고색을 주어 "여기 보며 튜닝하지 말 것"을 강조.
 */
import type { BacktestResult } from "@/lib/engine-types";
import { pct, signedPct, num, int } from "@/lib/format";

interface Props {
  inSample: BacktestResult;
  oos?: BacktestResult;
}

export function SampleMetrics({ inSample, oos }: Props) {
  const rows: { label: string; render: (r: BacktestResult) => string }[] = [
    { label: "총수익", render: (r) => signedPct(r.metrics.totalReturn) },
    { label: "샤프", render: (r) => num(r.metrics.sharpe, 2) },
    { label: "최대낙폭(MDD)", render: (r) => pct(r.metrics.maxDrawdown) },
    { label: "승률", render: (r) => pct(r.metrics.winRate) },
    { label: "거래수", render: (r) => int(r.metrics.tradeCount) },
  ];

  return (
    <table>
      <thead>
        <tr>
          <th>지표</th>
          <th className="num">In-sample</th>
          <th className="num" style={{ color: "#eab308" }}>
            Out-of-sample
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td>{row.label}</td>
            <td className="num">{row.render(inSample)}</td>
            <td className="num" style={{ color: oos ? "#fde047" : undefined }}>
              {oos ? row.render(oos) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
