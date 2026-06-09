import { NextResponse } from "next/server";
import {
  getControlFlags,
  writeControlFlags,
  type ControlUpdate,
} from "@/lib/artifacts";
import type { LiveMode } from "@/lib/engine-types";

export const dynamic = "force-dynamic";

const VALID_MODES: readonly LiveMode[] = ["DRY_RUN", "LIVE_SMALL", "LIVE"];

export async function GET() {
  try {
    const flags = await getControlFlags();
    return NextResponse.json({ flags });
  } catch (err) {
    console.error("[api/control GET] error:", err);
    return NextResponse.json(
      { error: "제어 플래그를 읽지 못했습니다." },
      { status: 500 },
    );
  }
}

/**
 * 제어 플래그 쓰기 — 웹의 유일한 쓰기 권한.
 *
 * 운영 동작(killSwitch / paused / requestedMode)만 허용. 종목·비중·주문 같은
 * 매매 지시는 입력 타입에 없으므로 들어와도 무시된다. 엔진이 폴링해서 따른다
 * (웹이 엔진을 직접 호출하지 않음).
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "JSON 본문이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const parsed = parseControlUpdate(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const flags = await writeControlFlags(parsed.update, parsed.updatedBy);
    return NextResponse.json({ flags });
  } catch (err) {
    console.error("[api/control POST] write failed:", err);
    return NextResponse.json(
      { error: "제어 플래그 쓰기에 실패했습니다. 다시 시도하세요." },
      { status: 500 },
    );
  }
}

type ParseResult =
  | { ok: true; update: ControlUpdate; updatedBy: string }
  | { ok: false; error: string };

function parseControlUpdate(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "본문은 객체여야 합니다." };
  }
  const x = body as Record<string, unknown>;
  const update: ControlUpdate = {};

  if ("killSwitch" in x) {
    if (typeof x.killSwitch !== "boolean") {
      return { ok: false, error: "killSwitch 는 boolean 이어야 합니다." };
    }
    update.killSwitch = x.killSwitch;
  }
  if ("paused" in x) {
    if (typeof x.paused !== "boolean") {
      return { ok: false, error: "paused 는 boolean 이어야 합니다." };
    }
    update.paused = x.paused;
  }
  if ("requestedMode" in x) {
    if (
      typeof x.requestedMode !== "string" ||
      !VALID_MODES.includes(x.requestedMode as LiveMode)
    ) {
      return {
        ok: false,
        error: `requestedMode 는 ${VALID_MODES.join(" | ")} 중 하나여야 합니다.`,
      };
    }
    update.requestedMode = x.requestedMode as LiveMode;
  }

  if (Object.keys(update).length === 0) {
    return {
      ok: false,
      error: "변경할 운영 플래그가 없습니다(killSwitch/paused/requestedMode).",
    };
  }

  const updatedBy =
    typeof x.updatedBy === "string" && x.updatedBy.length > 0
      ? x.updatedBy.slice(0, 64)
      : "web:operator";

  return { ok: true, update, updatedBy };
}
