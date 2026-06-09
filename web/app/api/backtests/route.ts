import { NextResponse } from "next/server";
import { listBacktestRuns } from "@/lib/artifacts";

// fs 접근 → 매 요청 동적.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const runs = await listBacktestRuns();
    return NextResponse.json({ runs });
  } catch (err) {
    console.error("[api/backtests] unexpected error:", err);
    return NextResponse.json(
      { runs: [], error: "백테스트 목록을 읽지 못했습니다." },
      { status: 500 },
    );
  }
}
