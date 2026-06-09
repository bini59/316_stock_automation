/**
 * 서버 전용 — 헤드리스 엔진 CLI 트리거 + 입력 검증.
 *
 * ★ 보안 절대 규율:
 *  - shell:true 절대 금지. spawn(arg 배열)만 사용 → 셸 주입 차단.
 *  - 모든 인자는 화이트리스트 검증 후에만 CLI 로 전달한다.
 *    심볼  ^[A-Z0-9^.\-]+$  (벤치마크/유니버스/VIX 티커),
 *    날짜  YYYY-MM-DD,
 *    숫자  Number 유한값,
 *    id    ^[A-Za-z0-9_\-]+$.
 *  - 이 모듈은 매매/전략/튜닝 로직을 단 한 줄도 갖지 않는다. 엔진을 실행할 뿐.
 */
import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";
import { engineCwd, engineEntry } from "./engine-paths";

// ── 검증 ────────────────────────────────────────────────────────────────────
const SYMBOL_RE = /^[A-Z0-9^.\-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_\-]+$/;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function assertSymbol(s: unknown, field: string): string {
  if (typeof s !== "string" || !SYMBOL_RE.test(s)) {
    throw new ValidationError(`${field}: 허용되지 않은 심볼 형식 (${String(s)})`);
  }
  return s;
}

function assertDate(s: unknown, field: string): string {
  if (typeof s !== "string" || !DATE_RE.test(s)) {
    throw new ValidationError(`${field}: YYYY-MM-DD 형식이어야 합니다 (${String(s)})`);
  }
  // 실재 날짜인지(2월 30일 등 차단)
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t)) throw new ValidationError(`${field}: 유효하지 않은 날짜 (${s})`);
  return s;
}

function assertPositiveNumber(v: unknown, field: string): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ValidationError(`${field}: 양의 유한 숫자여야 합니다 (${String(v)})`);
  }
  return n;
}

function assertRatio(v: unknown, field: string): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n >= 1) {
    throw new ValidationError(`${field}: 0~1 사이여야 합니다 (${String(v)})`);
  }
  return n;
}

function assertId(s: unknown, field: string): string {
  if (typeof s !== "string" || !ID_RE.test(s) || s.length > 80) {
    throw new ValidationError(`${field}: [A-Za-z0-9_-] 1~80자만 허용 (${String(s)})`);
  }
  return s;
}

function assertUniverse(v: unknown): string[] {
  if (!Array.isArray(v) || v.length === 0) {
    throw new ValidationError("universe: 비어 있지 않은 심볼 배열이어야 합니다");
  }
  if (v.length > 50) throw new ValidationError("universe: 최대 50개까지 허용");
  return v.map((s, i) => assertSymbol(s, `universe[${i}]`));
}

// ── 요청 → 검증된 인자 ────────────────────────────────────────────────────────
export interface BacktestRequest {
  universe: unknown;
  from: unknown;
  to: unknown;
  rebalance?: unknown;
  benchmark?: unknown;
  capital?: unknown;
  vix?: unknown;
  vix3m?: unknown;
  id?: unknown;
}

export interface TuneRequest extends BacktestRequest {
  ratio?: unknown;
}

/** 안전한 자동 id (사용자 id 미지정 시). 충돌 방지용 타임스탬프. */
function autoId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

function buildCommonArgs(req: BacktestRequest, universe: string[]): string[] {
  const args: string[] = ["--source", "yahoo"];
  args.push("--universe", universe.join(","));
  args.push("--from", assertDate(req.from, "from"));
  args.push("--to", assertDate(req.to, "to"));

  const benchmark = req.benchmark == null ? "SPY" : assertSymbol(req.benchmark, "benchmark");
  args.push("--benchmark", benchmark);

  // VIX 기본값(엔진 사용법과 동일). 명시되면 검증.
  const vix = req.vix == null ? "^VIX" : assertSymbol(req.vix, "vix");
  const vix3m = req.vix3m == null ? "^VIX3M" : assertSymbol(req.vix3m, "vix3m");
  args.push("--vix", vix, "--vix3m", vix3m);

  if (req.capital != null) {
    args.push("--capital", String(assertPositiveNumber(req.capital, "capital")));
  }
  return args;
}

export interface EngineRunResult {
  id: string;
  stdout: string;
}

/**
 * tsx 로 엔진 CLI 를 실행하고 완료까지 await.
 * 실패 시 stderr 를 담아 throw → 라우트가 사용자에게 그대로 전달.
 */
function runEngine(args: string[], cwd: string): Promise<string> {
  const tsxBin = path.join(cwd, "node_modules", ".bin", "tsx");
  return new Promise((resolve, reject) => {
    const child = spawn(tsxBin, [engineEntry(), ...args], {
      cwd,
      shell: false, // ★ 절대 셸 경유 금지
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      reject(new Error(`엔진 실행 시작 실패: ${err.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || stdout.trim() || `엔진이 코드 ${code} 로 종료`));
    });
  });
}

/** run-backtest 트리거. 검증된 BacktestRun id 반환. */
export async function runBacktestEngine(req: BacktestRequest): Promise<EngineRunResult> {
  const universe = assertUniverse(req.universe);
  const id = req.id == null ? autoId("run") : assertId(req.id, "id");

  const args = ["run-backtest", ...buildCommonArgs(req, universe), "--id", id];
  if (req.rebalance != null) {
    args.push("--rebalance", String(Math.round(assertPositiveNumber(req.rebalance, "rebalance"))));
  }

  const stdout = await runEngine(args, engineCwd());
  return { id, stdout };
}

/** tune 트리거. 검증된 TuningArtifact id 반환(상세 run 은 `${id}-best`). */
export async function runTuneEngine(req: TuneRequest): Promise<EngineRunResult> {
  const universe = assertUniverse(req.universe);
  const id = req.id == null ? autoId("tune") : assertId(req.id, "id");

  const args = ["tune", ...buildCommonArgs(req, universe), "--id", id];
  if (req.ratio != null) {
    args.push("--ratio", String(assertRatio(req.ratio, "ratio")));
  }

  const stdout = await runEngine(args, engineCwd());
  return { id, stdout };
}
