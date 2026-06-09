/**
 * 감성 파이프라인 — 본 레이어 바깥의 보조·선택 모듈 (docs/strategy/sentiment-risk.md §6).
 *
 * 이 레이어가 소비하는 SentimentSignal을 만드는 쪽의 경계 인터페이스다.
 * 핵심 계약: 여기서 무슨 일이 일어나도(LLM 호출 실패·타임아웃·없음) 본 레이어
 * (computeAggressiveness)는 sentiment=undefined를 받아 베이스라인으로 흡수한다.
 *
 * 현재 구현은 키가 없으므로 외부 호출이 전혀 없는 중립 스텁뿐이다.
 *  - LLM·외부 네트워크 호출 없음.
 *  - 가격 시계열을 딥러닝에 넣어 주가를 "예측"하는 접근은 과최적화에 취약해
 *    금지(overview.md). AI는 "예측"이 아니라 "텍스트 정보의 구조화"에만 쓴다.
 *
 * look-ahead: 실제 소스를 붙일 때 asOf는 반드시 신호가 만들어진 정보의 시점
 * (의사결정 시점 이전)이어야 한다. computeAggressiveness가 asOf>now를 누출로
 * 걸러내지만, 소스 단에서도 미래 텍스트를 넣지 않는 것이 1차 방어다.
 */
import type { SentimentSignal } from "../types/sentiment";

/**
 * 시장 전체 감성 신호의 공급원 (톱다운 일관: 종목 단위가 아니라 시장 하나).
 * asOf 이전까지의 정보만으로 신호를 만들어야 한다(look-ahead 차단).
 */
export interface SentimentSource {
  readonly name: string;

  /**
   * asOf 시점까지 입수 가능한 텍스트 정보로 감성 신호를 산출한다.
   * 신호를 만들 수 없으면 undefined를 반환한다(본 레이어가 중립 흡수).
   * 실패는 throw가 아니라 undefined 또는 호출부 try/catch로 흡수하는 것을 권장.
   */
  fetch(asOf: number): Promise<SentimentSignal | undefined>;
}

/**
 * 항상 "신호 없음"을 반환하는 중립 스텁.
 * AI-free(1급) 모드와 동등하게 작동시키기 위한 기본 소스.
 * 외부 호출이 전혀 없으므로 실패할 수 없다.
 */
export class NeutralSentimentSource implements SentimentSource {
  readonly name = "neutral-stub";

  // eslint 호환을 위해 asOf를 받지만 사용하지 않는다(항상 중립).
  async fetch(_asOf: number): Promise<SentimentSignal | undefined> {
    void _asOf;
    return undefined;
  }
}
