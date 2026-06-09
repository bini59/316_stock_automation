/**
 * 장중/휴장 가드 (execution-and-data.md 8절).
 *
 * 주입식 캘린더. 실어댑터(Phase 7)는 토스 Market Information으로 채우고,
 * 테스트·DRY_RUN은 상수/스텁 캘린더를 주입한다. 휴장·시간외엔 실주문을 차단한다.
 */

export interface MarketCalendar {
  /** 주어진 시점에 장이 열려 주문 제출이 가능한가 */
  isOpen(at: number): boolean;
}

/** 항상 열림 (백테스트·테스트용). 실거래엔 부적합. */
export const alwaysOpenCalendar: MarketCalendar = {
  isOpen: () => true,
};

/** 항상 닫힘 (휴장 가드 테스트용). */
export const alwaysClosedCalendar: MarketCalendar = {
  isOpen: () => false,
};

/**
 * 주입식 predicate 캘린더. 실어댑터가 토스 휴장일·세션 정보를 predicate로 감싼다.
 */
export function predicateCalendar(isOpen: (at: number) => boolean): MarketCalendar {
  return { isOpen };
}
