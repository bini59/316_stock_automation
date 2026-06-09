/**
 * POST /api/run — 헤드리스 엔진 run-backtest CLI 를 트리거한다.
 *
 * ★ 절대 원칙: 여기서 백테스트를 "계산"하지 않는다. 엔진(src/index.ts)을
 * 자식 프로세스로 실행하고, 엔진이 떨군 artifact 의 id 만 돌려준다.
 *
 * body: { universe: string[], from, to, rebalance?, benchmark?, capital?, vix?, vix3m?, id? }
 * 성공: { id }  실패: { error } (검증 실패 400, 엔진 실패 500)
 *
 * Yahoo 페치 + 백테스트는 수초~수십초 걸릴 수 있다 → 클라이언트는 로딩 표시 필수.
 */
import { NextResponse } from "next/server";
import { runBacktestEngine, ValidationError } from "@/lib/run-engine";

export const runtime = "nodejs"; // child_process 필요
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 초 (Yahoo 페치 + 백테스트 여유)

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }

  try {
    const result = await runBacktestEngine(body as never);
    return NextResponse.json({ id: result.id, stdout: result.stdout });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[api/run] engine error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "엔진 실행 실패" },
      { status: 500 },
    );
  }
}
