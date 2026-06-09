---
name: regime-trading-build
description: "레짐 기반 멀티 전략 자동매매 시스템의 에이전트 팀을 조율하는 오케스트레이터. 엔진·전략·실행·대시보드 구현을 검증 우선 순서로 팀에 분배하고 적대적 검증을 점진 수행. 트레이딩 시스템 구현·여러 레이어 동시 작업·백테스트 엔진부터 대시보드까지 빌드를 시작하면 이 스킬을 사용할 것."
---

# Regime Trading Build Orchestrator

레짐 기반 멀티 전략 자동매매 시스템(TypeScript, 미국주식, target-weight, 토스증권,
Next.js 대시보드)의 에이전트 팀을 조율한다. 설계는 `docs/`에 완결되어 있고, 이
오케스트레이터는 그 설계를 **검증 가능한 코드**로 옮기는 협업을 지휘한다.

## 실행 모드: 에이전트 팀

구현 팀원 + 적대적 검증자가 실시간으로 도전·교차검증하면 거짓 성과·경계면 버그를
조기에 잡을 수 있다(생성-검증 + 파이프라인 복합 패턴).

## dev-process와의 통합 (선행 필수)

이 프로젝트는 글로벌 dev-process를 따른다. **팀 구성 전에:**
1. **planner 에이전트**(글로벌)를 먼저 호출해 트랙 판별 + `tmp/TODO.md` 생성.
   다수 레이어 동시 작업이면 보통 **중량 트랙**이다.
2. 범용 작업은 글로벌 에이전트에 위임한다: 머지 전 **code-reviewer**(리뷰 게이트,
   CRITICAL/HIGH 필수 수정), 보안 **security-reviewer**(토스 OAuth 비밀·주문 경로),
   **tdd-guide**(테스트 우선), 빌드 실패 시 **build-error-resolver**.
   이 오케스트레이터는 **도메인 구현**만 팀에 분배한다.

## 에이전트 구성

| 팀원 | 타입 | 역할 | 스킬 | 출력 |
|------|------|------|------|------|
| quant-engine-engineer | quant-engine-engineer | types/·엔진·검증 프레임워크(토대) | quant-engine-build | `src/types/`,`src/engine/`,`src/validation/` |
| quant-strategist | quant-strategist | 국면·전략풀·감성·메타 | quant-strategy-impl | `src/regime/`,`src/strategies/`,`src/sentiment/`,`src/meta/` |
| execution-engineer | execution-engineer | 토스 어댑터·정산·안전장치 | toss-execution-build | `src/broker/`,`src/engine/reconcile.ts` |
| dashboard-engineer | dashboard-engineer | Next.js 대시보드 | trading-dashboard-build | `web/` |
| quant-validator | general-purpose | 적대적 검증(look-ahead·비용·과최적·경계면) | quant-validation-audit | `artifacts/_qa/` |

> 모든 팀원은 `model: "opus"`. quant-validator만 빌트인 `general-purpose`
> (Grep·스크립트 실행·교차 비교가 필요하므로 읽기 전용 Explore 불가).

## 워크플로우

### Phase 1: 준비
1. `tmp/TODO.md`(planner 산출)에서 트랙·그룹·의존성 확인.
2. `_workspace/`와 `artifacts/{backtests,live,_qa}/` 디렉터리 생성.
3. 설계 문서(`docs/`)를 팀 공통 입력으로 명시.

### Phase 2: 팀 구성
1. `TeamCreate(team_name:"regime-trading-team", members:[...])` — 위 5명을
   각 `agent_type`·`model:"opus"` + 역할 프롬프트(담당 스킬을 Skill 도구로 사용)로 스폰.
2. `TaskCreate`로 작업 등록(아래 의존성). 팀원당 4~6개.

### Phase 3: 검증 우선 구현 (CLAUDE.md 원칙 4)

**의존 순서로 분배 — 토대가 먼저, 그 위에 병렬, 검증은 점진:**

1. **Group 0 (토대, 선행)** — quant-engine-engineer가 `types/` 계약 + 엔진 +
   검증 프레임워크를 **가장 먼저** 확정. 모든 레이어가 여기에 의존하므로, 계약이
   안정되기 전 하위는 막힌다. 계약 확정·변경은 SendMessage로 전원에게 알린다.
   `depends_on`: 없음.

2. **병렬 그룹 (Group 0 이후)**:
   - quant-strategist: 전략 레이어. `depends_on`: Group 0 타입 계약.
   - execution-engineer: 추상 포트 → mock 어댑터 → reconcile. `depends_on`: Group 0
     `AccountState`/`Order`. (API 키 없으니 mock·골격 우선)

3. **대시보드 (계약 확정 후)** — dashboard-engineer. `/backtest`는 `BacktestRun`
   artifact가 나오면 실동작, `/live`는 mock `LiveSnapshot`으로 골격.
   `depends_on`: engine의 `BacktestRun` 형식, execution의 `LiveSnapshot` 형식.

4. **점진 검증 (각 모듈 완성 직후)** — quant-validator가 모듈 완성 알림을 받으면
   즉시 해당 경계면을 교차검증하고 `파일:라인`+수정법을 양쪽 팀원에게 SendMessage.
   전체 완성 후 1회가 아니라 **모듈마다** 수행해 경계면 불일치 전파를 막는다.

**팀원 간 통신 규칙:**
- engine-engineer가 타입 계약을 확정/변경하면 영향받는 전원에게 SendMessage.
- 하위 레이어 팀원은 새 타입이 필요하면 engine-engineer에게 요청(직접 수정 금지).
- dashboard/execution은 읽고 쓰는 artifact shape을 생산자와 교차 확인 후 구현.
- validator는 발견 즉시 해당 팀원(경계면이면 양쪽)에게 구체적 수정 요청.

**산출물 저장:** 구현은 `src/`·`web/`, 검증 리포트는 `artifacts/_qa/`,
중간 협의는 `_workspace/{phase}_{agent}_{artifact}.md`.

**리더 모니터링:** 팀원 유휴 알림 수신, TaskGet으로 진행률 확인, 막힌 팀원에
SendMessage로 재할당. 비현실적으로 좋은 백테스트가 보고되면 validator에 우선 검증 지시.

### Phase 4: 통합·게이트
1. 모든 작업 완료 대기(TaskGet). 워크트리 사용 시 변경량 적은 브랜치부터 머지.
2. 타입 체크 + 전체 테스트 통합 검증(pre-commit hook이 자동 실행 — 수동 실행 안 함).
3. **머지 게이트**: 글로벌 **code-reviewer**(CRITICAL/HIGH 필수 수정) +
   **security-reviewer**(OAuth 비밀·주문 경로) 호출.
4. quant-validator 최종 종합 리포트 확인(look-ahead·비용·과최적·경계면 전 항목).

### Phase 5: 정리
1. 팀원 종료(SendMessage) 후 `TeamDelete`.
2. `_workspace/`·`artifacts/_qa/` 보존(감사 추적). `tmp/TODO.md`는 dev-process대로 처리.
3. 사용자에게 결과·미검증·다음 단계(API 키 후 토스 실배선·캔들 깊이 확인) 요약 보고.

## 데이터 흐름

```
planner(글로벌) → tmp/TODO.md
        ↓
[리더] TeamCreate
  Group 0: engine-engineer → types/·engine·validation  ──(계약 SendMessage)──┐
        ↓                                                                     │
  병렬: strategist(전략) ‖ execution-engineer(포트·mock·reconcile) ←─────────┘
        ↓                          ↓
  dashboard-engineer ← BacktestRun/LiveSnapshot 형식
        ↓
  validator: 모듈마다 경계면 교차검증 → artifacts/_qa/ (+ 양쪽에 수정 요청)
        ↓
[리더] 통합 → code-reviewer + security-reviewer 게이트 → 보고
```

## 에러 핸들링

| 상황 | 전략 |
|------|------|
| 타입 계약 미확정으로 하위 막힘 | engine-engineer에 우선순위 상향 지시, 하위는 mock으로 선행 |
| 팀원 실패/중지 | 리더 감지 → SendMessage 상태 확인 → 재시작, 실패 시 작업 재할당 |
| 비현실적으로 좋은 백테스트 | validator 우선 검증(look-ahead/비용 의심), 원인 규명 전 합격 처리 금지 |
| 경계면 데이터 충돌 | 출처 병기, 삭제 금지, 생산자·소비자 합의로 해결 |
| 토스 API 키 부재 | mock 어댑터로 파이프라인 완성, 실배선은 키 확보 후로 분리 명시 |

## 테스트 시나리오

### 정상 흐름
1. 사용자가 "백테스트 엔진부터 만들자" 요청 → planner가 중량 트랙 + `tmp/TODO.md` 생성.
2. 팀 구성(5명). Group 0(engine) 먼저 types/·엔진·검증 확정, 전원에 계약 공유.
3. strategist·execution이 병렬 구현, validator가 모듈마다 look-ahead·비용·경계면 검증.
4. dashboard가 `BacktestRun` 읽어 `/backtest` 실동작, `/live` mock 골격.
5. 통합 후 code-reviewer/security-reviewer 게이트 통과 → 보고.

### 에러 흐름
1. strategist가 비현실적 샤프(예: 8.0) 백테스트를 보고.
2. 리더가 validator에 우선 검증 지시 → look-ahead 누출(전체 시계열 백분위) 발견.
3. validator가 `파일:라인`+수정법을 strategist·engine 양쪽에 SendMessage.
4. 수정·재검증 후에만 진행. 리포트에 원인·수정 기록.
