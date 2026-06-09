import { describe, it, expect } from "vitest";
import { resolveMode, nextStepUp } from "./mode";
import type { ControlFlags } from "../types/artifact";

function flags(over: Partial<ControlFlags> = {}): ControlFlags {
  return {
    killSwitch: false,
    paused: false,
    requestedMode: "DRY_RUN",
    updatedAt: 0,
    updatedBy: "test",
    ...over,
  };
}

describe("resolveMode — 모드 승급 가드", () => {
  it("killSwitch → 무조건 DRY_RUN 강등", () => {
    const r = resolveMode("LIVE", flags({ killSwitch: true, requestedMode: "LIVE" }));
    expect(r.mode).toBe("DRY_RUN");
  });

  it("paused → DRY_RUN 강등", () => {
    const r = resolveMode("LIVE_SMALL", flags({ paused: true, requestedMode: "LIVE_SMALL" }));
    expect(r.mode).toBe("DRY_RUN");
  });

  it("강등 요청은 즉시 허용", () => {
    const r = resolveMode("LIVE", flags({ requestedMode: "DRY_RUN" }));
    expect(r.mode).toBe("DRY_RUN");
  });

  it("한 단계 승급은 허용 (DRY_RUN → LIVE_SMALL)", () => {
    const r = resolveMode("DRY_RUN", flags({ requestedMode: "LIVE_SMALL" }));
    expect(r.mode).toBe("LIVE_SMALL");
  });

  it("점프 승급은 차단 (DRY_RUN → LIVE 요청 시 LIVE_SMALL까지만)", () => {
    const r = resolveMode("DRY_RUN", flags({ requestedMode: "LIVE" }));
    expect(r.mode).toBe("LIVE_SMALL");
  });

  it("LIVE_SMALL → LIVE 한 단계 승급 허용", () => {
    const r = resolveMode("LIVE_SMALL", flags({ requestedMode: "LIVE" }));
    expect(r.mode).toBe("LIVE");
  });

  it("같은 모드 유지", () => {
    const r = resolveMode("LIVE_SMALL", flags({ requestedMode: "LIVE_SMALL" }));
    expect(r.mode).toBe("LIVE_SMALL");
  });

  it("killSwitch가 승급 요청보다 우선", () => {
    const r = resolveMode("DRY_RUN", flags({ killSwitch: true, requestedMode: "LIVE_SMALL" }));
    expect(r.mode).toBe("DRY_RUN");
  });
});

describe("nextStepUp", () => {
  it("DRY_RUN → LIVE_SMALL", () => {
    expect(nextStepUp("DRY_RUN")).toBe("LIVE_SMALL");
  });
  it("LIVE_SMALL → LIVE", () => {
    expect(nextStepUp("LIVE_SMALL")).toBe("LIVE");
  });
  it("LIVE는 최상단(자신 유지)", () => {
    expect(nextStepUp("LIVE")).toBe("LIVE");
  });
});
