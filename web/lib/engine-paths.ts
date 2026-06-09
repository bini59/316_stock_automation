/**
 * 서버 전용 경로 해석 — 헤드리스 엔진 CLI를 어디서/어떻게 실행할지 결정한다.
 *
 * ★ 절대 원칙(dashboards.md 0절): 웹은 매매 로직을 갖지 않는다. 이 모듈은
 * 엔진(src/index.ts) CLI를 자식 프로세스로 "트리거"하기 위한 경로만 계산한다.
 *
 * 까다로운 점: 엔진의 writeBacktestRun/writeTuningResult 는 **cwd 기준 상대경로**
 * `artifacts/backtests`·`artifacts/tuning` 에 기록한다(src/pipeline/writeArtifact.ts).
 * 한편 리더(artifacts.ts)는 ARTIFACTS_DIR 또는 `<web cwd>/../artifacts` 를 읽는다.
 * 둘이 어긋나면 "실행은 됐는데 목록에 안 뜸" 런타임 버그가 난다.
 *
 * 그래서 여기서 두 경로를 한 곳에서 도출해 일치시킨다:
 *  - artifactsRoot(): 리더와 동일 규칙(ARTIFACTS_DIR override 포함).
 *  - engineCwd(): 엔진이 상대 `artifacts/` 를 위 artifactsRoot 와 같은 곳에
 *    떨구도록, artifactsRoot 의 부모를 cwd 로 준다.
 *  - engineEntry(): src/index.ts 절대경로(저장소 루트 기준).
 */
import "server-only";
import path from "node:path";

/** 리더(artifacts.ts)와 반드시 동일한 규칙으로 artifacts 루트를 해석한다. */
export function artifactsRoot(): string {
  const override = process.env.ARTIFACTS_DIR;
  if (override && override.length > 0) return path.resolve(override);
  return path.resolve(process.cwd(), "..", "artifacts");
}

/** 저장소 루트(web/ 의 부모). src/index.ts 가 여기 있다. */
export function repoRoot(): string {
  const override = process.env.ENGINE_ROOT;
  if (override && override.length > 0) return path.resolve(override);
  return path.resolve(process.cwd(), "..");
}

/** 엔진 CLI 엔트리(src/index.ts) 절대경로. */
export function engineEntry(): string {
  return path.join(repoRoot(), "src", "index.ts");
}

/**
 * 엔진을 실행할 cwd.
 * 엔진은 상대 `artifacts/` 에 쓰므로, artifactsRoot 의 부모를 cwd 로 주면
 * 엔진 산출물이 리더가 읽는 바로 그 디렉터리에 떨어진다(경계면 일치).
 */
export function engineCwd(): string {
  return path.dirname(artifactsRoot());
}
