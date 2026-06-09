import { test, expect } from "@playwright/test";

test.describe("/backtest 렌더", () => {
  test("샘플 BacktestRun 의 패널들이 렌더된다", async ({ page }) => {
    await page.goto("/backtest");

    await expect(page.getByTestId("backtest-page")).toBeVisible();

    // 런 목록 (3개 샘플)
    await expect(page.getByText("run-momentum-bull-001")).toBeVisible();
    await expect(page.getByText("run-overfit-suspect-087")).toBeVisible();

    // 보정 규율 배너 (in-sample/OOS 분리 경고)
    await expect(page.getByText(/튜닝은/).first()).toBeVisible();

    // 다중검정 카운터
    await expect(page.getByTestId("tries-index")).toBeVisible();

    // equity 차트 컨테이너 (lightweight-charts 가 canvas 를 그린다)
    await expect(page.locator("canvas").first()).toBeVisible({
      timeout: 15_000,
    });

    // 게이트 배지 (통과/불합격 둘 중 하나)
    await expect(
      page.getByText(/게이트 통과|게이트 불합격/).first(),
    ).toBeVisible();
  });

  test("두 런을 선택하면 비교 표가 나타난다", async ({ page }) => {
    await page.goto("/backtest");
    const compareBoxes = page.locator('input[aria-label^="compare "]');
    await compareBoxes.nth(0).check();
    await compareBoxes.nth(1).check();
    await expect(page.getByText("파라미터 diff")).toBeVisible();
  });
});
