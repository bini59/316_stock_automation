/**
 * POST /api/tune — 헤드리스 엔진 tune CLI 를 트리거한다.
 *
 * ★ 절대 원칙: 파라미터 탐색·OOS 시험·다중검정 보정은 전부 엔진(src/pipeline/tune.ts)에
 * 있다. 웹은 실행만 시키고 TuningArtifact id 를 돌려준다.
 *
 * body: { universe: string[], from, to, ratio?, benchmark?, capital?, vix?, vix3m?, id? }
 * 성공: { id }  (상세 BacktestRun 은 `${id}-best`)
 */
import { NextResponse } from "next/server";
import { runTuneEngine, ValidationError } from "@/lib/run-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }

  try {
    const result = await runTuneEngine(body as never);
    return NextResponse.json({ id: result.id, stdout: result.stdout });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[api/tune] engine error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "튜닝 실행 실패" },
      { status: 500 },
    );
  }
}
