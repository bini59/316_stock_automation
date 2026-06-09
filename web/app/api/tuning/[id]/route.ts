import { NextResponse } from "next/server";
import { getTuningArtifact } from "@/lib/artifacts";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const item = await getTuningArtifact(params.id);
    if (!item) {
      return NextResponse.json(
        { error: `TuningArtifact '${params.id}' 를 찾을 수 없습니다.` },
        { status: 404 },
      );
    }
    return NextResponse.json({ item });
  } catch (err) {
    console.error("[api/tuning/:id] unexpected error:", err);
    return NextResponse.json(
      { error: "튜닝 결과를 읽지 못했습니다." },
      { status: 500 },
    );
  }
}
