import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readControlFlags, failSafeFlags } from "./control-flags";
import type { ControlFlags } from "../types/artifact";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ctrl-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readControlFlags — fail-safe DRY_RUN", () => {
  it("정상 파일은 그대로 파싱", async () => {
    const flags: ControlFlags = {
      killSwitch: false,
      paused: false,
      requestedMode: "LIVE_SMALL",
      updatedAt: 111,
      updatedBy: "kevin",
    };
    const path = join(dir, "control.json");
    await writeFile(path, JSON.stringify(flags));
    expect(await readControlFlags(path)).toEqual(flags);
  });

  it("파일 부재 → fail-safe(killSwitch true, DRY_RUN)", async () => {
    const flags = await readControlFlags(join(dir, "nope.json"));
    expect(flags.killSwitch).toBe(true);
    expect(flags.requestedMode).toBe("DRY_RUN");
  });

  it("손상된 JSON → fail-safe", async () => {
    const path = join(dir, "control.json");
    await writeFile(path, "{ not valid json ");
    const flags = await readControlFlags(path);
    expect(flags.killSwitch).toBe(true);
    expect(flags.requestedMode).toBe("DRY_RUN");
  });

  it("스키마 불일치(필드 누락) → fail-safe", async () => {
    const path = join(dir, "control.json");
    await writeFile(path, JSON.stringify({ killSwitch: false }));
    const flags = await readControlFlags(path);
    expect(flags.killSwitch).toBe(true);
  });

  it("requestedMode가 BACKTEST 등 비-LiveMode면 fail-safe", async () => {
    const path = join(dir, "control.json");
    await writeFile(
      path,
      JSON.stringify({
        killSwitch: false,
        paused: false,
        requestedMode: "BACKTEST",
        updatedAt: 1,
        updatedBy: "x",
      }),
    );
    const flags = await readControlFlags(path);
    expect(flags.killSwitch).toBe(true);
  });

  it("failSafeFlags는 항상 보수적", () => {
    const f = failSafeFlags();
    expect(f.killSwitch).toBe(true);
    expect(f.paused).toBe(true);
    expect(f.requestedMode).toBe("DRY_RUN");
  });
});
