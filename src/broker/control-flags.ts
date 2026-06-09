/**
 * ControlFlags 폴링 (execution-and-data.md 8절, dashboards.md 5절).
 *
 * 웹이 쓰는 유일한 데이터. 엔진이 매 사이클 폴링해서 따른다.
 * fail-safe(절대 원칙): 파일 부재·손상·파싱 실패 시 보수적으로 DRY_RUN
 * (killSwitch=true 취급). UI가 죽어도 엔진은 안전한 마지막 상태로 계속.
 */
import { readFile } from "node:fs/promises";
import type { ControlFlags } from "../types/artifact";
import type { LiveMode } from "../types/broker-port";

/** 손상·부재 시 강제되는 보수적 기본값 (killSwitch on → DRY_RUN) */
export function failSafeFlags(updatedBy = "failsafe"): ControlFlags {
  return {
    killSwitch: true,
    paused: true,
    requestedMode: "DRY_RUN",
    updatedAt: 0,
    updatedBy,
  };
}

const LIVE_MODES: ReadonlySet<string> = new Set<LiveMode>([
  "DRY_RUN",
  "LIVE_SMALL",
  "LIVE",
]);

/** 파싱된 객체가 ControlFlags 형태인지 검증 (타입 가드) */
function isControlFlags(value: unknown): value is ControlFlags {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["killSwitch"] === "boolean" &&
    typeof v["paused"] === "boolean" &&
    typeof v["requestedMode"] === "string" &&
    LIVE_MODES.has(v["requestedMode"]) &&
    typeof v["updatedAt"] === "number" &&
    typeof v["updatedBy"] === "string"
  );
}

/**
 * control.json을 읽어 ControlFlags 반환. 어떤 실패(부재·손상·스키마 불일치)도
 * 예외를 던지지 않고 failSafeFlags()로 강등한다.
 */
export async function readControlFlags(path: string): Promise<ControlFlags> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return failSafeFlags("failsafe:missing");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failSafeFlags("failsafe:corrupt");
  }

  if (!isControlFlags(parsed)) {
    return failSafeFlags("failsafe:schema");
  }
  return parsed;
}
