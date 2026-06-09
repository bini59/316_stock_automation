import { NextResponse } from "next/server";
import { listTuningArtifacts } from "@/lib/artifacts";

// fs 접근 → 매 요청 동적.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await listTuningArtifacts();
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[api/tuning] unexpected error:", err);
    return NextResponse.json(
      { items: [], error: "튜닝 목록을 읽지 못했습니다." },
      { status: 500 },
    );
  }
}
