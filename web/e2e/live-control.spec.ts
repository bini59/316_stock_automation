import { test, expect } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";

const CONTROL_PATH = path.resolve(
  process.cwd(),
  "e2e",
  ".artifacts",
  "live",
  "control.json",
);

async function readControl(): Promise<{ killSwitch: boolean } | null> {
  try {
    return JSON.parse(await fs.readFile(CONTROL_PATH, "utf-8"));
  } catch {
    return null;
  }
}

test.describe("/live + 제어 채널", () => {
  test("mock 스냅샷 골격이 렌더된다", async ({ page }) => {
    await page.goto("/live");
    await expect(page.getByTestId("live-page")).toBeVisible();
    await expect(page.getByTestId("mode-badge")).toBeVisible();
    await expect(page.getByTestId("mock-badge")).toBeVisible();
    await expect(page.getByTestId("control-panel")).toBeVisible();
  });

  test("킬스위치 토글이 ControlFlags(control.json)를 뒤집는다", async ({
    page,
  }) => {
    await page.goto("/live");
    const kill = page.getByTestId("kill-switch");
    await expect(kill).toBeVisible();

    // 초기 상태 읽기 (파일 없으면 fail-safe off)
    const before = await readControl();
    const beforeKill = before?.killSwitch ?? false;

    await kill.click();

    // control.json 이 생기고 killSwitch 가 반대로 뒤집혀야 한다.
    await expect
      .poll(async () => (await readControl())?.killSwitch, { timeout: 10_000 })
      .toBe(!beforeKill);

    // UI 상태도 반영
    await expect(page.getByTestId("kill-state")).toContainText(
      !beforeKill ? "ON" : "OFF",
    );

    // 다시 눌러 원복
    await kill.click();
    await expect
      .poll(async () => (await readControl())?.killSwitch, { timeout: 10_000 })
      .toBe(beforeKill);
  });

  test("일시정지 토글도 control.json 에 반영된다", async ({ page }) => {
    await page.goto("/live");
    const pause = page.getByTestId("pause-toggle");
    await pause.click();
    await expect
      .poll(
        async () => {
          try {
            const c = JSON.parse(await fs.readFile(CONTROL_PATH, "utf-8"));
            return c.paused;
          } catch {
            return undefined;
          }
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  });
});
