import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * E2E: 격리된 artifacts 디렉터리(web/e2e/.artifacts)를 ARTIFACTS_DIR 로 주입해
 * 실제 프로젝트 artifacts 를 건드리지 않는다. globalSetup 이 샘플을 채운다.
 */
const E2E_ARTIFACTS = path.resolve(process.cwd(), "e2e", ".artifacts");

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "line" : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run build && npm run start -- -p 3100",
    url: "http://127.0.0.1:3100/backtest",
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ARTIFACTS_DIR: E2E_ARTIFACTS,
    },
  },
});
