import { describe, it, expect } from "vitest";
import { Broker, usBrokerConfig, krBrokerConfig } from "./broker";

describe("Broker 비용 모델", () => {
  it("슬리피지: 매수는 비싸게, 매도는 싸게 체결", () => {
    const b = new Broker(usBrokerConfig({ slippageRate: 0.01 }));
    expect(b.fillBuy(100)).toBeCloseTo(101, 10);
    expect(b.fillSell(100)).toBeCloseTo(99, 10);
  });

  it("비용은 매수/매도 모두 항상 양수로 빠져나간다", () => {
    const b = new Broker(usBrokerConfig());
    expect(b.cost("BUY", 10000)).toBeGreaterThan(0);
    expect(b.cost("SELL", 10000)).toBeGreaterThan(0);
  });

  it("음수 notional도 절대값으로 처리(항상 양의 비용)", () => {
    const b = new Broker(usBrokerConfig());
    expect(b.cost("BUY", -10000)).toBeCloseTo(b.cost("BUY", 10000), 10);
  });

  describe("US 프로필", () => {
    const b = new Broker(usBrokerConfig({ commissionRate: 0.001, feeRate: 0.0001, fxSpread: 0.002 }));
    it("매수: 수수료 + FX (매도세·fee 없음)", () => {
      // 0.001 + 0.002 = 0.003 of notional
      expect(b.cost("BUY", 10000)).toBeCloseTo(30, 10);
    });
    it("매도: 수수료 + fee + FX (매도세 0)", () => {
      // 0.001 + 0.0001 + 0.002 = 0.0031
      expect(b.cost("SELL", 10000)).toBeCloseTo(31, 10);
    });
    it("US는 taxRate가 0", () => {
      expect(b.config.taxRate).toBe(0);
    });
  });

  describe("KR 프로필", () => {
    const b = new Broker(krBrokerConfig({ commissionRate: 0.0001, taxRate: 0.0018 }));
    it("매수: 수수료만 (매도세 없음, fx 없음)", () => {
      expect(b.cost("BUY", 10000)).toBeCloseTo(1, 10);
    });
    it("매도: 수수료 + 매도세", () => {
      // 0.0001 + 0.0018 = 0.0019
      expect(b.cost("SELL", 10000)).toBeCloseTo(19, 10);
    });
    it("KR은 feeRate·fxSpread가 0", () => {
      expect(b.config.feeRate).toBe(0);
      expect(b.config.fxSpread).toBe(0);
    });
  });

  it("매도 비용이 매수 비용보다 크다(세금·fee 비대칭)", () => {
    const us = new Broker(usBrokerConfig());
    expect(us.cost("SELL", 10000)).toBeGreaterThan(us.cost("BUY", 10000));
    const kr = new Broker(krBrokerConfig());
    expect(kr.cost("SELL", 10000)).toBeGreaterThan(kr.cost("BUY", 10000));
  });
});
