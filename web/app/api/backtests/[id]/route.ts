import { NextResponse } from "next/server";
import { getBacktestRun } from "@/lib/artifacts";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const run = await getBacktestRun(params.id);
    if (!run) {
      return NextResponse.json(
        { error: `BacktestRun '${params.id}' 를 찾을 수 없습니다.` },
        { status: 404 },
      );
    }
    return NextResponse.json({ run });
  } catch (err) {
    console.error("[api/backtests/:id] unexpected error:", err);
    return NextResponse.json(
      { error: "백테스트를 읽지 못했습니다." },
      { status: 500 },
    );
  }
}
