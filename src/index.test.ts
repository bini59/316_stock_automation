import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, writeFile, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs, runBacktestCommand } from "./index";
import type { BacktestRun } from "./types/artifact";

describe("CLI parseArgs", () => {
  it("command + --flags 파싱", () => {
    const r = parseArgs(["run-backtest", "--data-dir", "./d", "--rebalance", "5", "--verbose"]);
    expect(r.command).toBe("run-backtest");
    expect(r.flags["data-dir"]).toBe("./d");
    expect(r.flags.rebalance).toBe("5");
    expect(r.flags.verbose).toBe("true");
  });
});

describe("CLI run-backtest (E2E, 파일 산출)", () => {
  let dir = "";
  let outFile = "";

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    if (outFile) await rm(outFile, { force: true });
  });

  function csv(closes: number[]): string {
    const rows = ["date,open,high,low,close,volume"];
    closes.forEach((c, i) => {
      const d = new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
      rows.push(`${d},${c},${c * 1.005},${c * 0.995},${c},1000000`);
    });
    return rows.join("\n");
  }

  it("CSV 적재 → 파이프라인 → BacktestRun JSON 산출(0 API 키)", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "bt-cli-"));
    const n = 260;
    const bench = Array.from({ length: n }, (_, i) => 100 * (1 + 0.0003 * i));
    const xlk = Array.from({ length: n }, (_, i) => 50 * (1 + 0.0004 * i));
    const xlf = Array.from({ length: n }, (_, i) => 40 * (1 + 0.0002 * i));
    await writeFile(path.join(dir, "SPY.csv"), csv(bench));
    await writeFile(path.join(dir, "XLK.csv"), csv(xlk));
    await writeFile(path.join(dir, "XLF.csv"), csv(xlf));

    const artDir = path.join(dir, "out");
    await mkdir(artDir, { recursive: true });

    // runBacktestCommand는 기본 artifacts/backtests에 쓴다 — 여기선 반환 경로만 확인 후 정리
    outFile = await runBacktestCommand({
      "data-dir": dir,
      benchmark: "SPY",
      universe: "XLK,XLF",
      id: "cli-integration-test",
      rebalance: "5",
    });

    const json = JSON.parse(await readFile(outFile, "utf8")) as BacktestRun;
    expect(json.id).toBe("cli-integration-test");
    expect(json.universe).toEqual(["XLK", "XLF"]);
    expect(json.result.equityCurve.length).toBeGreaterThan(50);
    expect(json.oosResult).toBeDefined();
    expect(json.split.inSampleEnd).toBeGreaterThan(0);
    expect(typeof json.gate.passed).toBe("boolean");
    // 비용 반영: 유한·음수자본 없음
    expect(json.result.equityCurve.every((e) => Number.isFinite(e) && e >= 0)).toBe(true);
  });
});
