---
name: toss-execution-build
description: "토스증권 Open API 연동·계좌상태·목표↔현재 정산(reconcile)·주문 실행·안전장치를 구현하는 절차. 추상 포트(AccountSource/MarketDataSource/OrderExecutor), OAuth2, 엔드포인트 매핑, 실행 모드(DRY_RUN/LIVE), 킬스위치, 멱등성, 유니버스 한정 정산. 토스/주문/계좌/체결/브로커 연동을 시작하면 반드시 이 스킬을 사용할 것."
---

# Toss Execution Build — 안전한 주문 실행 구축 절차

전략 스택의 목표비중을 실제 주문으로 옮기는 레이어. 명확한 규칙으로만 작동해야
안전하고, 토스는 **샌드박스가 없으므로** 안전장치가 1급 시민이다. 설계 원본은
`docs/coding/execution-and-data.md`이며 이 스킬은 구현 절차를 담는다.

## 작업 순서 (mock 먼저, 실배선은 키 확보 후)

1. **추상 포트**(`src/types/broker-port.ts`) — 브로커 무관 인터페이스.
2. **mock 어댑터**(`src/broker/mock/`) — 시뮬레이션 계좌·시세·체결. 백테스트·DRY_RUN용.
3. **정산**(`src/engine/reconcile.ts`) — 목표↔현재 → `Order[]`.
4. **토스 실어댑터**(`src/broker/toss/`) — API 키 확보 후 실배선.

> 현재 API 키가 없다. 인터페이스 + 골격 + mock으로 전체 파이프라인을 완성하고,
> 토스 실어댑터는 나중에 같은 인터페이스로 끼운다. 이렇게 하면 키 없이도 백테스트·
> DRY_RUN 검증이 가능하다.

## 추상 포트 — 전략 스택은 브로커를 모른다

`AccountSource`(계좌상태) / `MarketDataSource`(시세·캔들) / `OrderExecutor`(주문).
토스든 시뮬레이션이든 같은 인터페이스의 구현체일 뿐. 이렇게 해야 백테스트와 실거래가
**동일한 정산 로직**을 공유하고, 브로커를 바꿔도 전략이 안 깨진다.

## 정산 (reconcile) — target-weight의 핵심

출력은 "사라"가 아니라 목표상태다. 주문 = 목표금액 − 현재평가액.
- **유니버스 안만 손댄다**(확정된 결정). 유니버스 밖 보유는 매도 대상도 NAV도 아님.
- **금액 기반 주문**: 토스가 amount-based를 지원해 단주 반올림이 거의 사라진다.
- **무거래 밴드**: 미세 드리프트(`< minTradeNotional`)는 거래하지 않는다(비용 통제).
- **통화 = USD 단일**.

## 토스 API 매핑

Base `https://openapi.tossinvest.com`, OAuth2 Client Credentials(`POST /oauth2/token`),
계좌·주문 호출엔 `X-Tossinvest-Account` 헤더. 엔드포인트 매핑 표는
`docs/coding/execution-and-data.md` 5절 참조(holdings·buying-power·orders·candles·
commissions·sellable-quantity). 레이트리밋(주문 6/s 등)·429 `Retry-After` + 지수 백오프.
REST only(WebSocket 없음) → 실시간은 폴링.

## 실행 모드 (샌드박스 부재 대응)

BACKTEST → DRY_RUN(실계좌·실시세 읽되 주문 미제출) → LIVE_SMALL(소액) → LIVE.
**DRY_RUN이 페이퍼트레이딩을 대신**한다. 단계는 백테스트-실거래 일치도를 확인하며
순차 승급만 허용한다.

## 안전장치 (코드로 강제)

- **킬스위치**: `ControlFlags.killSwitch` → 다음 폴링에서 즉시 DRY_RUN 강등 + 미체결 취소.
- **멱등성**: 클라이언트 식별자 + 미체결 조회 대조로 **중복주문 차단**(재시도·네트워크
  오류 대비). 가장 흔하고 위험한 실거래 버그.
- **사전 sanity**: 주문가가 현재가에서 비정상 이탈 아닌지, 매도수량 ≤ 보유, 매수금액
  ≤ buying-power. 1천만원 초과는 `confirmHighValueOrder`.
- **fail-safe**: 플래그·상태 읽기 실패 시 보수적으로 DRY_RUN.
- **비밀 관리**: OAuth client_id/secret은 환경변수. 하드코딩 절대 금지. 노출 시 즉시 회전.

## 품질 기준

- 정산·멱등성·sanity 가드는 단위 테스트 우선. mock 어댑터로 모드별 흐름을 검증.
- security-reviewer에게 OAuth 비밀·주문 경로 보안 리뷰 요청.

## 참고 문서

- `docs/coding/execution-and-data.md` — 전체 설계(타입·매핑·모드·안전장치·비용)
- 토스 API: `https://openapi.tossinvest.com/openapi-docs/latest/openapi.json`(정본)
