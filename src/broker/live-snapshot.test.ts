import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLiveSnapshot, writeLiveSnapshot } from "./live-snapshot";
import { readControlFlags } from "./control-flags";
import type { AccountState } from "../types/account";
import type { RegimeState } from "../types/regime";
import type { LiveSnapshot } from "../types/artifact";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "snap-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const account: AccountState = {
  accountSeq: "t",
  baseCurrency: "USD",
  cash: 1000,
  holdings: {},
  nav: 1000,
  asOf: 0,
};

const regime: RegimeState = {
  asOf: 0,
  trend: 0.5,
  volatility: 0.2,
  trendQuality: 0.7,
  membership: { bull: 0.6, bear: 0.1, chop: 0.3, crisis: 0 },
  label: "bull",
  confidence: 0.6,
};

function input() {
  return {
    asOf: 123,
    mode: "DRY_RUN" as const,
    account,
    regime,
    aggressiveness: 0.8,
    targetWeights: { AAPL: 0.5 },
    openOrders: [],
    recentDecisions: ["mode: killSwitch → DRY_RUN"],
    pnl: { day: 10, total: 100 },
  };
}

describe("buildLiveSnapshot", () => {
  it("입력을 LiveSnapshot으로 정규화(불변 복사)", () => {
    const src = input();
    const snap = buildLiveSnapshot(src);
    expect(snap.asOf).toBe(123);
    expect(snap.mode).toBe("DRY_RUN");
    expect(snap.targetWeights).toEqual({ AAPL: 0.5 });
    // 불변: 원본 weights를 바꿔도 snapshot 불변
    expect(snap.targetWeights).not.toBe(src.targetWeights);
  });
});

describe("writeLiveSnapshot", () => {
  it("artifacts/live 경로에 원자적으로 기록되고 다시 읽힌다", async () => {
    const snap = buildLiveSnapshot(input());
    const path = join(dir, "live", "snapshot.json");
    await writeLiveSnapshot(snap, path);
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as LiveSnapshot;
    expect(parsed.mode).toBe("DRY_RUN");
    expect(parsed.regime.label).toBe("bull");
  });

  it("ControlFlags와 같은 디렉터리에서 왕복: 정상 플래그 읽기", async () => {
    // 스냅샷·플래그가 같은 artifacts/live 디렉터리에 공존하는 통합 확인
    const path = join(dir, "snapshot.json");
    await writeLiveSnapshot(buildLiveSnapshot(input()), path);
    // 같은 디렉터리에 control이 없으면 폴링은 fail-safe
    const flags = await readControlFlags(join(dir, "control.json"));
    expect(flags.killSwitch).toBe(true);
  });
});
