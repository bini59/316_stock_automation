import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * E2E 격리 artifacts 준비:
 * - e2e/.artifacts/backtests/ 에 샘플 BacktestRun 복사
 * - e2e/.artifacts/live/ 비움(킬스위치 토글로 control.json 이 생기는지 검증)
 */
async function globalSetup() {
  const root = process.cwd();
  const e2eArtifacts = path.join(root, "e2e", ".artifacts");
  const backtests = path.join(e2eArtifacts, "backtests");
  const live = path.join(e2eArtifacts, "live");

  await fs.rm(e2eArtifacts, { recursive: true, force: true });
  await fs.mkdir(backtests, { recursive: true });
  await fs.mkdir(live, { recursive: true });

  const sampleDir = path.join(root, "fixtures", "sample-backtest-runs");
  const files = await fs.readdir(sampleDir);
  for (const f of files.filter((x) => x.endsWith(".json"))) {
    await fs.copyFile(path.join(sampleDir, f), path.join(backtests, f));
  }
}

export default globalSetup;
