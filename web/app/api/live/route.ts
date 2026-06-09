import { NextResponse } from "next/server";
import { getLiveSnapshot } from "@/lib/artifacts";
import { mockLiveSnapshot } from "@/lib/mock-live";

export const dynamic = "force-dynamic";

/**
 * 실거래 스냅샷. artifacts/live/snapshot.json 이 있으면 그걸,
 * 없으면(토스 키 확보 전) mock LiveSnapshot 골격을 돌려준다.
 * `source` 로 mock 여부를 명시해 UI가 배지로 표시한다.
 */
export async function GET() {
  try {
    const real = await getLiveSnapshot();
    if (real) {
      return NextResponse.json({ snapshot: real, source: "artifact" });
    }
    return NextResponse.json({ snapshot: mockLiveSnapshot(), source: "mock" });
  } catch (err) {
    console.error("[api/live] unexpected error:", err);
    return NextResponse.json(
      { snapshot: mockLiveSnapshot(), source: "mock", error: "스냅샷 읽기 실패" },
      { status: 200 },
    );
  }
}
