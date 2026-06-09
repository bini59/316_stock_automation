"use client";

/**
 * 제어 패널 — 웹의 **유일한 쓰기 표면**.
 *
 * 운영 동작만: 킬스위치 / 일시정지 / 모드 전환 요청.
 * 종목·비중·주문을 지정하는 입력은 없다(타입에도 없음). 엔진이 ControlFlags 를
 * 폴링해서 따른다 — 이 패널은 엔진을 직접 호출하지 않는다.
 *
 * 킬스위치는 가장 단순·확실하게: 누르면 즉시 killSwitch=true 쓰기.
 */
import { useState } from "react";
import type { ControlFlags, LiveMode } from "@/lib/engine-types";
import { dateTime } from "@/lib/format";

interface Props {
  flags: ControlFlags;
  onChanged: (next: ControlFlags) => void;
}

const MODES: LiveMode[] = ["DRY_RUN", "LIVE_SMALL", "LIVE"];

async function postControl(
  body: Record<string, unknown>,
): Promise<ControlFlags> {
  const res = await fetch("/api/control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, updatedBy: "web:operator" }),
  });
  const data = (await res.json()) as { flags?: ControlFlags; error?: string };
  if (!res.ok || !data.flags) {
    throw new Error(data.error ?? `제어 쓰기 실패 (HTTP ${res.status})`);
  }
  return data.flags;
}

export function ControlPanel({ flags, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [requested, setRequested] = useState<LiveMode>(flags.requestedMode);

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      const next = await postControl(body);
      onChanged(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" data-testid="control-panel">
      <h2 className="card-title">운영 제어 (유일한 쓰기)</h2>

      {err ? (
        <div className="banner danger" data-testid="control-error">
          {err} — 다시 시도하세요.
        </div>
      ) : null}

      {/* 킬스위치 — 가장 크고 단순 */}
      <div className="row" style={{ marginBottom: 16 }}>
        <button
          className={`kill ${flags.killSwitch ? "armed" : ""}`}
          disabled={busy}
          data-testid="kill-switch"
          aria-pressed={flags.killSwitch}
          onClick={() => run({ killSwitch: !flags.killSwitch })}
        >
          {flags.killSwitch
            ? "킬스위치 ON — 해제하기"
            : "🛑 킬스위치 발동 (즉시 DRY_RUN 강등)"}
        </button>
        <span className="dim" data-testid="kill-state">
          현재: <strong>{flags.killSwitch ? "ON" : "OFF"}</strong>
        </span>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <button
          disabled={busy}
          data-testid="pause-toggle"
          aria-pressed={flags.paused}
          onClick={() => run({ paused: !flags.paused })}
        >
          {flags.paused ? "▶ 재개" : "⏸ 일시정지"}
        </button>
        <span className="dim">
          현재: <strong>{flags.paused ? "일시정지됨" : "가동 중"}</strong>
        </span>
      </div>

      <div className="row">
        <label className="dim">모드 전환 요청:</label>
        <select
          value={requested}
          disabled={busy}
          data-testid="mode-select"
          onChange={(e) => setRequested(e.target.value as LiveMode)}
        >
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button
          className="primary"
          disabled={busy || requested === flags.requestedMode}
          data-testid="mode-request"
          onClick={() => run({ requestedMode: requested })}
        >
          요청
        </button>
        <span className="dim">
          요청된 모드: <strong>{flags.requestedMode}</strong>
        </span>
      </div>

      <p className="dim" style={{ fontSize: 12, marginTop: 16 }}>
        엔진이 매 사이클 이 플래그를 폴링해 따른다. 모드 승급은 엔진 가드 통과
        시에만 적용된다. 종목·비중·주문 지정 경로는 존재하지 않는다.
      </p>
      <p className="dim" style={{ fontSize: 11, marginTop: 4 }}>
        마지막 변경: {dateTime(flags.updatedAt)} · {flags.updatedBy}
      </p>
    </div>
  );
}
