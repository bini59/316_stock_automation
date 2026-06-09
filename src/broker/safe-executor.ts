/**
 * SafeOrderExecutor — 안전장치를 코드로 강제하는 OrderExecutor 데코레이터.
 * (execution-and-data.md 8절, dashboards.md 5절)
 *
 * 어떤 OrderExecutor(mock 또는 토스 실어댑터)든 감싸서 제출 직전에 가드를 건다:
 *  1. ControlFlags 해석 → 유효 모드(killSwitch/paused/승급 가드). fail-safe DRY_RUN.
 *  2. 장중/휴장 가드(실주문 모드에서만).
 *  3. 멱등성: clientOrderId 부여 + 미체결 대조로 중복 차단.
 *  4. 사전 sanity: 가격 이탈/매도≤보유/매수≤buying-power/고액주문/한도.
 *  5. 유효 모드로 위임 실행(DRY_RUN이면 내부 executor가 미제출).
 *
 * 비가역 동작 없음 — 가드를 통과한 주문만 내부 executor로 넘긴다. 내부가 mock이면
 * 실제 제출은 일어나지 않는다.
 */
import type { OrderExecutor, ExecMode, LiveMode } from "../types/broker-port";
import type { Order, OrderResult } from "../types/order";
import type { ControlFlags } from "../types/artifact";
import type { AccountState } from "../types/account";
import type { MarketCalendar } from "./calendar";
import type { SanityConfig, SanityContext } from "./sanity";
import { resolveMode } from "./mode";
import { assignClientOrderId, dedupeAgainstOpen } from "./idempotency";
import { checkSanity } from "./sanity";

export interface SafeExecutorDeps {
  /** 감싸는 실제 실행기(mock/toss) */
  readonly inner: OrderExecutor;
  /** 현재 ControlFlags 제공(엔진이 폴링한 값). 호출 실패 시 deps에서 fail-safe 처리됨 */
  readonly getFlags: () => Promise<ControlFlags>;
  /** 현재 계좌(sanity buying-power·보유 검사) */
  readonly getAccount: () => Promise<AccountState>;
  /** 브로커 미체결 주문의 clientOrderId 집합(멱등성 대조) */
  readonly getOpenOrderIds: () => Promise<ReadonlySet<string>>;
  readonly calendar: MarketCalendar;
  readonly sanityConfig: SanityConfig;
  /** sanity 부가 컨텍스트(가격·고액 승인 훅) */
  readonly sanityContextExtras?: Omit<SanityContext, "account">;
  /** 현재 시각(휴장 가드). 미지정 시 Date.now */
  readonly clock?: () => number;
}

export interface SafeSubmitOutcome {
  readonly results: readonly OrderResult[];
  readonly effectiveMode: LiveMode;
  readonly decisions: readonly string[];
}

export class SafeOrderExecutor implements OrderExecutor {
  private readonly deps: SafeExecutorDeps;

  constructor(deps: SafeExecutorDeps) {
    this.deps = deps;
  }

  /** OrderExecutor 계약: 결과 배열만 반환(가드 의사결정은 submitGuarded로 노출). */
  async submit(orders: readonly Order[], mode: ExecMode): Promise<OrderResult[]> {
    const requestedMode: LiveMode = mode === "BACKTEST" ? "DRY_RUN" : mode;
    const outcome = await this.submitGuarded(orders, requestedMode);
    return [...outcome.results];
  }

  /**
   * 가드를 적용한 제출. 의사결정 로그·유효 모드를 함께 반환(LiveSnapshot 기록용).
   * cycleId는 멱등성 id 결정에 쓰인다(같은 사이클 재시도 → 같은 id).
   */
  async submitGuarded(
    orders: readonly Order[],
    requestedMode: LiveMode,
    cycleId = "cycle",
  ): Promise<SafeSubmitOutcome> {
    const decisions: string[] = [];

    // 1) ControlFlags 해석 → 유효 모드.
    // ★ fail-safe(QA C1): 의존성(getFlags/getAccount/getOpenOrderIds)이 throw해도
    //   가드는 절대 throw로 새지 않는다 — 보수적으로 DRY_RUN으로 강등하고 미제출.
    //   제어 평면이 불건전할 때(원격 플래그·계좌 API 장애)가 가장 위험하므로.
    let flags: ControlFlags;
    try {
      flags = await this.deps.getFlags();
    } catch (err) {
      decisions.push(`fail-safe: getFlags 실패 → DRY_RUN (${errMsg(err)})`);
      return { results: orders.map((o) => unsubmitted(o, "fail-safe: flags 조회 실패")), effectiveMode: "DRY_RUN", decisions };
    }
    const resolved = resolveMode(requestedMode, flags);
    const effectiveMode = resolved.mode;
    decisions.push(`mode: ${resolved.reason}`);

    // 2) 멱등성: clientOrderId 부여
    const withIds = orders.map((o) => assignClientOrderId(cycleId, o));

    // 3) 미체결 대조로 중복 차단
    let openIds: ReadonlySet<string>;
    try {
      openIds = await this.deps.getOpenOrderIds();
    } catch (err) {
      decisions.push(`fail-safe: getOpenOrderIds 실패 → DRY_RUN (${errMsg(err)})`);
      return { results: orders.map((o) => unsubmitted(o, "fail-safe: 미체결 조회 실패")), effectiveMode: "DRY_RUN", decisions };
    }
    const { toSubmit, blocked } = dedupeAgainstOpen(withIds, openIds);
    for (const b of blocked) {
      decisions.push(`idempotency: 중복 차단 ${b.clientOrderId ?? b.symbol}`);
    }

    // 4) 사전 sanity
    let account: AccountState;
    try {
      account = await this.deps.getAccount();
    } catch (err) {
      decisions.push(`fail-safe: getAccount 실패 → DRY_RUN (${errMsg(err)})`);
      return { results: orders.map((o) => unsubmitted(o, "fail-safe: 계좌 조회 실패")), effectiveMode: "DRY_RUN", decisions };
    }
    const sanity = checkSanity(
      toSubmit,
      { account, ...this.deps.sanityContextExtras },
      this.deps.sanityConfig,
    );
    for (const r of sanity.rejected) {
      decisions.push(`sanity 거부 ${r.order.symbol}: ${r.reason}`);
    }

    // 5) 장중/휴장 가드 — 실주문 모드에서만. DRY_RUN은 계산만이라 통과.
    const now = (this.deps.clock ?? Date.now)();
    const marketOpen = this.deps.calendar.isOpen(now);
    const submitMode = this.decideSubmitMode(effectiveMode, marketOpen, decisions);

    // 차단된 주문은 미제출 결과로 명시(조용히 삼키지 않음)
    const blockedResults: OrderResult[] = [
      ...blocked.map((o) => unsubmitted(o, "idempotency: duplicate")),
      ...sanity.rejected.map((r) => unsubmitted(r.order, `sanity: ${r.reason}`)),
    ];

    if (sanity.accepted.length === 0) {
      return { results: blockedResults, effectiveMode, decisions };
    }

    const innerResults = await this.deps.inner.submit(sanity.accepted, submitMode);
    return {
      results: [...innerResults, ...blockedResults],
      effectiveMode,
      decisions,
    };
  }

  /** 휴장 시 실주문 모드를 DRY_RUN으로 강등(계산은 유지). DRY_RUN은 그대로. */
  private decideSubmitMode(
    effectiveMode: LiveMode,
    marketOpen: boolean,
    decisions: string[],
  ): ExecMode {
    if (effectiveMode === "DRY_RUN") return "DRY_RUN";
    if (!marketOpen) {
      decisions.push("calendar: 휴장/시간외 → DRY_RUN 강등");
      return "DRY_RUN";
    }
    return effectiveMode;
  }
}

function unsubmitted(order: Order, note: string): OrderResult {
  return { order, submitted: false, filledNotional: 0, note };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
