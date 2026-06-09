import { test, expect } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * 백테스트/튜닝 "실행" 플로우 E2E.
 *
 * 엔진 CLI 는 Yahoo 네트워크에 의존하고 수십초 걸리므로, 여기서는 /api/run·
 * /api/tune 라우트를 route interception 으로 모킹해 **UI 플로우**(폼 제출 →
 * 로딩 → 결과 반영)만 빠르게 검증한다. spawn→artifact→read 의 실제 배선은
 * 별도 라우트 단위 테스트(run-engine 검증)와 수동 스모크로 확인한다.
 */

test.describe("새 백테스트 실행 폼", () => {
  test("폼이 렌더되고, 제출하면 /api/run 을 호출하고 새 런을 선택한다", async ({
    page,
  }) => {
    // /api/run 모킹: 새 id 반환
    await page.route("**/api/run", async (route) => {
      expect(route.request().method()).toBe("POST");
      const body = route.request().postDataJSON();
      expect(Array.isArray(body.universe)).toBeTruthy();
      expect(body.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "run-momentum-bull-001", stdout: "ok" }),
      });
    });

    await page.goto("/backtest");
    await expect(page.getByTestId("run-backtest-form")).toBeVisible();

    // 섹터 ETF 체크박스 기본 선택 확인
    await expect(page.getByLabel("universe XLK")).toBeChecked();

    await page.getByTestId("run-submit").click();

    // 완료 후 해당 런이 선택되어 상세가 보인다(샘플 fixture 에 존재하는 id 사용)
    await expect(page.getByText("run-momentum-bull-001").first()).toBeVisible();
  });

  test("유니버스를 모두 해제하면 클라이언트 검증 오류를 보여준다", async ({
    page,
  }) => {
    await page.goto("/backtest");
    const boxes = page.locator('input[aria-label^="universe "]');
    const n = await boxes.count();
    for (let i = 0; i < n; i++) await boxes.nth(i).uncheck();
    await page.getByTestId("run-submit").click();
    await expect(page.getByTestId("run-error")).toContainText("최소 1개");
  });
});

test.describe("튜닝 실행 + 비교 테이블", () => {
  test("튜닝 탭에서 제출하면 비교 테이블과 OOS 게이트·과최적화 격차가 렌더된다", async ({
    page,
  }) => {
    // 샘플 TuningArtifact 로드(ARTIFACTS_DIR 격리 디렉터리에서 읽음)
    const fixture = JSON.parse(
      await fs.readFile(
        path.join(
          process.cwd(),
          "fixtures",
          "sample-tuning",
          "tune-sample-001.json",
        ),
        "utf-8",
      ),
    );

    await page.route("**/api/tune", async (route) => {
      expect(route.request().method()).toBe("POST");
      const body = route.request().postDataJSON();
      expect(body.ratio).toBeGreaterThan(0);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "tune-sample-001", stdout: "ok" }),
      });
    });
    await page.route("**/api/tuning/tune-sample-001", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ item: fixture }),
      });
    });

    await page.goto("/backtest");
    await page.getByTestId("tab-tuning").click();
    await expect(page.getByTestId("tune-form")).toBeVisible();

    await page.getByTestId("tune-submit").click();

    // 비교 테이블
    await expect(page.getByTestId("tuning-result")).toBeVisible();
    await expect(
      page.getByText("SPY 매수후보유 vs 기본 vs 튜닝"),
    ).toBeVisible();

    // 다중검정 카운터
    await expect(page.getByTestId("tune-tries")).toHaveText("24");

    // OOS 게이트(불합격)
    await expect(page.getByTestId("tune-gate")).toContainText("OOS 불합격");

    // 과최적화 격차 강조(1.24 > 0.5 임계 → 경고)
    await expect(page.getByTestId("overfit-gap")).toContainText("과최적화 의심");

    // in-sample 무의미 규율 배너
    await expect(
      page.getByText("in-sample 성과는 의미 없다"),
    ).toBeVisible();

    // bestRun 상세 링크
    await expect(page.getByTestId("bestrun-link")).toHaveAttribute(
      "href",
      /run=run-momentum-bull-001/,
    );
  });
});
