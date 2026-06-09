/**
 * 서버 전용 artifact 리더 (엔진 ↔ 웹의 유일한 접점).
 *
 * 프로젝트 루트의 `artifacts/` 를 fs 로 읽는다. 절대 클라이언트 번들에 포함되면
 * 안 된다(파일시스템 접근). API route / server component 에서만 import 할 것.
 *
 * 빈 상태(artifact 누락·형식 불일치)는 throw 하지 않고 graceful 하게 처리한다:
 * - 디렉터리 없음 → 빈 목록
 * - JSON 파싱 실패 → 해당 파일 건너뜀(로깅) → 페이지는 빈 상태 UI
 */
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  BacktestRun,
  LiveSnapshot,
  ControlFlags,
  LiveMode,
  TuningArtifact,
} from "./engine-types";

/**
 * 프로젝트 루트 결정.
 * - next dev/build 는 cwd = web/ 에서 실행 → 부모가 루트.
 * - ARTIFACTS_DIR 환경변수로 명시 override 가능(E2E·CI 격리용).
 */
function artifactsRoot(): string {
  const override = process.env.ARTIFACTS_DIR;
  if (override && override.length > 0) return override;
  return path.resolve(process.cwd(), "..", "artifacts");
}

const backtestsDir = () => path.join(artifactsRoot(), "backtests");
const tuningDir = () => path.join(artifactsRoot(), "tuning");
const liveDir = () => path.join(artifactsRoot(), "live");
const controlPath = () => path.join(liveDir(), "control.json");
const livePath = () => path.join(liveDir(), "snapshot.json");

async function readJsonSafe<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null; // 없음 = 빈 상태
    // 파싱/권한 실패는 가시화하되 페이지를 죽이지 않는다.
    console.error(`[artifacts] failed to read ${file}:`, err);
    return null;
  }
}

/** backtests/ 의 모든 BacktestRun 을 createdAt 내림차순으로. */
export async function listBacktestRuns(): Promise<BacktestRun[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(backtestsDir());
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    console.error("[artifacts] failed to list backtests:", err);
    return [];
  }

  const jsonFiles = entries.filter(
    (f) => f.endsWith(".json") && !f.startsWith("."),
  );

  const runs = await Promise.all(
    jsonFiles.map((f) => readJsonSafe<BacktestRun>(path.join(backtestsDir(), f))),
  );

  return runs
    .filter((r): r is BacktestRun => r !== null && isValidRun(r))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** id 로 단일 BacktestRun. 없으면 null. */
export async function getBacktestRun(id: string): Promise<BacktestRun | null> {
  // path traversal 차단: id 는 파일명 한 조각이어야 한다.
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return null;
  const run = await readJsonSafe<BacktestRun>(
    path.join(backtestsDir(), `${id}.json`),
  );
  if (run && isValidRun(run)) return run;
  // id 가 createdAt 정렬 목록 중 하나일 수도 있으므로 폴백.
  const all = await listBacktestRuns();
  return all.find((r) => r.id === id) ?? null;
}

/** 최소 shape 검증 — 경계면 불일치(필수 필드 누락)를 런타임에 거른다. */
function isValidRun(r: unknown): r is BacktestRun {
  if (typeof r !== "object" || r === null) return false;
  const x = r as Record<string, unknown>;
  return (
    typeof x.id === "string" &&
    typeof x.createdAt === "number" &&
    typeof x.result === "object" &&
    x.result !== null &&
    Array.isArray((x.result as Record<string, unknown>).equityCurve) &&
    typeof x.gate === "object" &&
    x.gate !== null
  );
}

/** tuning/ 의 모든 TuningArtifact 를 createdAt 내림차순으로. */
export async function listTuningArtifacts(): Promise<TuningArtifact[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(tuningDir());
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    console.error("[artifacts] failed to list tuning:", err);
    return [];
  }

  const jsonFiles = entries.filter(
    (f) => f.endsWith(".json") && !f.startsWith("."),
  );

  const items = await Promise.all(
    jsonFiles.map((f) =>
      readJsonSafe<TuningArtifact>(path.join(tuningDir(), f)),
    ),
  );

  return items
    .filter((t): t is TuningArtifact => t !== null && isValidTuning(t))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** id 로 단일 TuningArtifact. 없으면 null. */
export async function getTuningArtifact(
  id: string,
): Promise<TuningArtifact | null> {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return null; // path traversal 차단
  const item = await readJsonSafe<TuningArtifact>(
    path.join(tuningDir(), `${id}.json`),
  );
  if (item && isValidTuning(item)) return item;
  const all = await listTuningArtifacts();
  return all.find((t) => t.id === id) ?? null;
}

/** 최소 shape 검증 — 경계면 불일치(필수 필드 누락)를 런타임에 거른다. */
function isValidTuning(t: unknown): t is TuningArtifact {
  if (typeof t !== "object" || t === null) return false;
  const x = t as Record<string, unknown>;
  if (
    typeof x.id !== "string" ||
    typeof x.createdAt !== "number" ||
    typeof x.bestRunId !== "string" ||
    typeof x.result !== "object" ||
    x.result === null
  ) {
    return false;
  }
  const r = x.result as Record<string, unknown>;
  return (
    typeof r.best === "object" &&
    r.best !== null &&
    typeof r.triesIndex === "number" &&
    typeof r.gate === "object" &&
    r.gate !== null &&
    typeof r.tuned === "object" &&
    typeof r.baseline === "object" &&
    typeof r.buyHold === "object"
  );
}

/** 실거래 스냅샷. mock(키 확보 전)이든 실데이터든 동일 경로에서 읽는다. */
export async function getLiveSnapshot(): Promise<LiveSnapshot | null> {
  return readJsonSafe<LiveSnapshot>(livePath());
}

const DEFAULT_CONTROL: ControlFlags = {
  killSwitch: false,
  paused: false,
  requestedMode: "DRY_RUN",
  updatedAt: 0,
  updatedBy: "system:default",
};

/**
 * 제어 플래그 읽기. fail-safe: 파일 없음/손상 시 보수적 기본값(킬스위치 off,
 * DRY_RUN). 엔진 측 fail-safe(읽기 실패 시 DRY_RUN 강등)와 별개로, UI 표시용.
 */
export async function getControlFlags(): Promise<ControlFlags> {
  const flags = await readJsonSafe<ControlFlags>(controlPath());
  if (!flags || !isValidControl(flags)) return { ...DEFAULT_CONTROL };
  return flags;
}

function isValidControl(c: unknown): c is ControlFlags {
  if (typeof c !== "object" || c === null) return false;
  const x = c as Record<string, unknown>;
  return (
    typeof x.killSwitch === "boolean" &&
    typeof x.paused === "boolean" &&
    typeof x.requestedMode === "string"
  );
}

const VALID_MODES: readonly LiveMode[] = ["DRY_RUN", "LIVE_SMALL", "LIVE"];

/** 제어 채널이 허용하는 부분 업데이트(운영 동작에 한정). */
export interface ControlUpdate {
  killSwitch?: boolean;
  paused?: boolean;
  requestedMode?: LiveMode;
}

/**
 * 제어 플래그 쓰기 — 웹이 가진 **유일한 쓰기 권한**.
 *
 * 종목·비중·주문은 절대 받지 않는다(타입 자체에 그런 필드가 없음).
 * 원자적 쓰기(임시 파일 → rename)로 엔진이 폴링 중 반쪽 파일을 읽지 않게 한다.
 */
export async function writeControlFlags(
  update: ControlUpdate,
  updatedBy: string,
): Promise<ControlFlags> {
  const current = await getControlFlags();

  const next: ControlFlags = {
    killSwitch:
      typeof update.killSwitch === "boolean"
        ? update.killSwitch
        : current.killSwitch,
    paused:
      typeof update.paused === "boolean" ? update.paused : current.paused,
    requestedMode:
      update.requestedMode && VALID_MODES.includes(update.requestedMode)
        ? update.requestedMode
        : current.requestedMode,
    updatedAt: Date.now(),
    updatedBy: updatedBy || "web:anonymous",
  };

  await fs.mkdir(liveDir(), { recursive: true });
  const tmp = `${controlPath()}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf-8");
  await fs.rename(tmp, controlPath());
  return next;
}
