"use client";

/**
 * 런 비교 — 여러 BacktestRun 의 params diff + 성과 diff 표.
 * 어떤 매매 로직도 없다: 두 산출물의 숫자를 나란히 비교만.
 */
import type { BacktestRun } from "@/lib/engine-types";
import { pct, signedPct, num, int } from "@/lib/format";

interface Props {
  runs: BacktestRun[];
}

export function RunCompare({ runs }: Props) {
  if (runs.length < 2) {
    return (
      <p className="dim" style={{ fontSize: 13 }}>
        비교하려면 위 목록에서 2개 이상의 런을 선택하세요.
      </p>
    );
  }

  // 선택된 런들의 모든 파라미터 키 합집합.
  const paramKeys = Array.from(
    new Set(runs.flatMap((r) => Object.keys(r.params))),
  ).sort();

  const perfRows: {
    label: string;
    render: (r: BacktestRun) => string;
  }[] = [
    { label: "샤프 (IS)", render: (r) => num(r.result.metrics.sharpe, 2) },
    {
      label: "샤프 (OOS)",
      render: (r) =>
        r.oosResult ? num(r.oosResult.metrics.sharpe, 2) : "—",
    },
    {
      label: "MDD (IS)",
      render: (r) => pct(r.result.metrics.maxDrawdown),
    },
    {
      label: "총수익 (IS)",
      render: (r) => signedPct(r.result.metrics.totalReturn),
    },
    {
      label: "승률 (IS)",
      render: (r) => pct(r.result.metrics.winRate),
    },
    {
      label: "거래수 (IS)",
      render: (r) => int(r.result.metrics.tradeCount),
    },
    {
      label: "게이트",
      render: (r) => (r.gate.passed ? "통과" : "불합격"),
    },
    { label: "시도 #", render: (r) => `#${r.triesIndex}` },
  ];

  return (
    <div style={{ overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            <th>항목</th>
            {runs.map((r) => (
              <th key={r.id} className="num mono">
                {r.id}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={runs.length + 1} className="dim">
              성과
            </td>
          </tr>
          {perfRows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              {runs.map((r) => (
                <td key={r.id} className="num">
                  {row.render(r)}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td colSpan={runs.length + 1} className="dim">
              파라미터 diff
            </td>
          </tr>
          {paramKeys.map((key) => {
            const values = runs.map((r) => r.params[key]);
            const allSame = values.every((v) => v === values[0]);
            return (
              <tr key={key}>
                <td className={allSame ? "" : "mono"}>
                  {allSame ? key : <strong>{key}</strong>}
                </td>
                {runs.map((r, i) => (
                  <td
                    key={r.id}
                    className="num"
                    style={{ color: allSame ? "var(--text-dim)" : undefined }}
                  >
                    {values[i] === undefined ? "—" : num(values[i] as number, 4)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
