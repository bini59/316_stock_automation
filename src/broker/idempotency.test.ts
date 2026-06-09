import { describe, it, expect } from "vitest";
import {
  makeClientOrderId,
  assignClientOrderId,
  dedupeAgainstOpen,
} from "./idempotency";
import type { Order } from "../types/order";

function order(over: Partial<Order> = {}): Order {
  return { symbol: "AAPL", side: "BUY", notional: 500, reason: "rebalance", ...over };
}

describe("멱등성 — clientOrderId", () => {
  it("같은 의도는 같은 id (결정적)", () => {
    const a = makeClientOrderId("c1", order());
    const b = makeClientOrderId("c1", order());
    expect(a).toBe(b);
  });

  it("notional 미세 흔들림은 양자화로 같은 id", () => {
    const a = makeClientOrderId("c1", order({ notional: 500.001 }));
    const b = makeClientOrderId("c1", order({ notional: 500.004 }));
    expect(a).toBe(b);
  });

  it("다른 사이클은 다른 id", () => {
    expect(makeClientOrderId("c1", order())).not.toBe(makeClientOrderId("c2", order()));
  });

  it("assignClientOrderId는 이미 있으면 유지", () => {
    const o = order({ clientOrderId: "preset" });
    expect(assignClientOrderId("c1", o).clientOrderId).toBe("preset");
  });

  it("assignClientOrderId는 없으면 부여(불변)", () => {
    const o = order();
    const assigned = assignClientOrderId("c1", o);
    expect(assigned.clientOrderId).toBeDefined();
    expect(o.clientOrderId).toBeUndefined(); // 원본 불변
  });
});

describe("dedupeAgainstOpen — 중복 주문 차단", () => {
  it("미체결에 같은 id가 있으면 차단", () => {
    const o = assignClientOrderId("c1", order());
    const { toSubmit, blocked } = dedupeAgainstOpen([o], new Set([o.clientOrderId!]));
    expect(toSubmit).toHaveLength(0);
    expect(blocked).toHaveLength(1);
  });

  it("미체결에 없으면 제출 대상", () => {
    const o = assignClientOrderId("c1", order());
    const { toSubmit, blocked } = dedupeAgainstOpen([o], new Set());
    expect(toSubmit).toHaveLength(1);
    expect(blocked).toHaveLength(0);
  });

  it("배치 내부 중복도 차단(같은 의도 두 번)", () => {
    const o1 = assignClientOrderId("c1", order());
    const o2 = assignClientOrderId("c1", order());
    const { toSubmit, blocked } = dedupeAgainstOpen([o1, o2], new Set());
    expect(toSubmit).toHaveLength(1);
    expect(blocked).toHaveLength(1);
  });

  it("재시도 시나리오: 첫 제출 후 미체결로 남으면 재시도가 차단됨", () => {
    const o = assignClientOrderId("c1", order());
    // 1차 제출 → 미체결로 등록되었다고 가정
    const open = new Set([o.clientOrderId!]);
    // 네트워크 오류로 같은 사이클 재시도
    const retry = assignClientOrderId("c1", order());
    const { toSubmit } = dedupeAgainstOpen([retry], open);
    expect(toSubmit).toHaveLength(0); // 중복 미발생
  });
});
