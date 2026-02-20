# Agent Orchestrator MCP Server PRD (v1.0)

## 1) 제품 개요 및 범위
본 제품은 Gemini CLI(마스터)가 MCP를 통해 tmux의 현재 윈도우에 여러 서브에이전트 Gemini CLI를 split-pane으로 생성하고, 작업을 큐로 분배하며, 결과를 JSONL 이벤트로 수집/브로드캐스트하는 “Agent Orchestrator MCP Server”다. Gemini CLI는 settings.json의 mcpServers에 등록된 MCP 서버를 발견하고, 도구(TOOLS) 실행 및 리소스(RESOURCES) 읽기를 수행한다.

### In-scope
- 로컬 tmux 기반 에이전트 생성/삭제/목록/상태 조회(CRUD)
- 에이전트별 FIFO 작업 큐, 1개씩 실행(단일 실행), soft cancel
- 서브에이전트 자율 루프: wait_for_command(timeout) 반복 호출(무한 블록 금지)
- 이벤트/아티팩트 저장: outbox + run-level broadcast(JSONL)

### Out-of-scope (v1)
- tmux 없는 환경에서의 네이티브 실행(추후 백엔드 플러그인으로 확장)
- 에이전트 간 암묵적 “공유 메모리”(모든 공유는 명시적 파일/이벤트로만)

## 2) 사용자 여정(필수 플로우)
사용자는 마스터 Gemini CLI에서 “에이전트 N명(역할 포함) 생성”을 지시하면, MCP 서버가 현재 터미널이 속한 tmux 윈도우에 pane을 split 생성하고 각 pane에서 Gemini CLI를 실행한다. Gemini CLI는 MCP 서버의 도구를 자동 선택해 실행할 수 있으나, 서버 신뢰(trust) 설정에 따라 확인 프롬프트가 발생할 수 있으므로 운영 정책을 PRD에서 명시해야 한다.

- Setup: mcpServers에 서버 등록(command/url/httpUrl), /mcp에서 CONNECTED 및 Tools/Resources/Prompts 확인.
- Create: agent_create로 pane 생성 → 초기 지시사항 주입 → 서브에이전트 ready 이벤트 확인 후에만 작업 분배.
- Run: task_enqueue로 작업 큐잉 → 서브에이전트는 wait_for_command로 수신 → emit_event(ack/progress/result…) 기록.
- Observe: events_read/Resources로 상태/최근 이벤트/아티팩트 참조(필요 시 @resource-uri 사용).
- Recover: 에이전트 크래시/무응답 감지 → 재시작/재큐잉 정책에 따라 복구.

## 3) 기능 요구사항(가장 중요)

### 3.1 tmux 세션/윈도우 타겟팅
- R-TS1: “현재 터미널에서 실행 중인 마스터 Gemini CLI가 속한 tmux pane”을 기준으로, 같은 세션/같은 윈도우에만 에이전트 pane을 split 생성해야 한다.
- R-TS2: 사용자가 tmux 밖에서 실행 중이면, MCP 서버는 새 tmux 세션을 1회 생성하고 그 세션을 “현재 대상”으로 삼는다.
- R-TS3: 기존 사용자 pane은 삭제/이동/이름변경하지 않는다(에이전트 생성 시에만 현재 윈도우 레이아웃 조정 허용).

### 3.2 에이전트 CRUD
- R-AC1: agent_create는 (a) pane 생성, (b) Gemini CLI 실행, (c) 초기 지시사항 주입, (d) ready 핸드셰이크가 완료되어야 “Ready” 상태로 반환한다.
- R-AC2: agent_delete는 기본 graceful 종료(soft)이며, force kill은 별도 플래그/도구로 분리하고 확인이 필요하다.
- R-AC3: agent_list/agent_get은 최소로 다음을 제공해야 한다: agent_id, role, status, tmux_pane_id, queue_depth, running_task_id?, last_event_seq.

### 3.3 작업 큐(에이전트당 FIFO, 단일 실행) — 확정
- R-Q1: 에이전트는 한 번에 1개 작업만 실행하며, 나머지는 FIFO로 대기한다.
- R-Q2: 모든 작업은 task_id를 가지며, 각 task에 대해 terminal 이벤트(result|error|canceled)가 정확히 1회 outbox에 기록되어야 한다.
- R-Q3: task_enqueue는 “순번(position)”을 반환해야 하며, 순번은 FIFO 의미를 가진다.

### 3.4 soft cancel — 확정
- R-C1: task_cancel은 running/queued task에 대해 cancel_requested=true 상태를 기록한다(즉시 강제 종료하지 않음).
- R-C2: 에이전트는 다음 안전 체크포인트에서 실행을 중단하고 terminal 이벤트 canceled를 기록해야 한다(불가능하면 error에 canceled 플래그로 대체 가능).

### 3.5 서브에이전트 자율 루프(무인 운용) — 필수
- R-L1: 서브에이전트는 “무한 블록”이 아니라 wait_for_command(timeout_ms) long-poll 반복 호출로 명령을 수신한다.
- R-L2: 명령을 받으면 emit_event(ack) → 작업 수행 → emit_event(result|error|canceled, done=true) → 다시 wait_for_command로 돌아간다.
- R-L3: 초기 지시사항에는 “루프 규약, 출력 규약(JSON), FIFO/soft cancel 제약, artifacts 경로”가 반드시 포함되어야 한다.

### 3.6 이벤트/브로드캐스트(관측성)
- R-E1: per-agent outbox.jsonl은 append-only이며 단조 증가 seq를 가져야 한다.
- R-E2: run-level broadcast.jsonl을 제공하며, 최소한 모든 terminal 이벤트를 집계해 기록한다.
- R-E3: events_read(since_seq)는 델타만 반환해 마스터가 효율적으로 폴링할 수 있어야 한다.

### 3.7 Gemini CLI MCP 권한 분리(권장 요구사항)
서브에이전트가 “마스터용 도구(에이전트 생성/삭제 등)”를 실수로 호출하지 않도록, Gemini CLI의 서버 설정에서 includeTools/excludeTools를 활용해 서브에이전트가 접근 가능한 도구를 제한하는 구성을 지원해야 한다. (예: 서브에이전트는 wait_for_command, emit_event만 allowlist)

## 4) 비기능 요구사항(안정성/보안/운영)
Gemini CLI는 Stdio/SSE/Streamable HTTP 트랜스포트를 지원하므로, v1은 로컬 tmux 제어에 적합한 stdio를 기본으로 한다. stdio MCP 서버는 stdout에 MCP 메시지 외 내용을 출력하면 안 되며(stderr 로깅은 허용), 이 규칙을 위반하면 통신이 깨지므로 “로깅은 stderr/파일”을 필수 요구사항으로 둔다. [1]

### 4.1 성능/확장
- N=3 에이전트 생성 시간 목표(환경별): T초 이내(측정 방식 정의).
- 큐 폴링: events_read는 1초 내 응답(최근 N개 tail, max_events 제한 포함).

### 4.2 오류/복구
- Heartbeat: 에이전트는 최소 주기마다 heartbeat/progress 이벤트를 남길 수 있어야 하며(옵션), 마스터는 일정 시간 무응답 시 “stalled”로 표시한다.
- 재시작 정책: 프로세스 다운 감지 시 에이전트 재시작, running task 처리(재큐잉/실패 처리)는 명시된 정책에 따른다.

### 4.3 보안
- 파일 접근 루트 제한: .agents/ 및 프로젝트 루트만 접근(서버에서 강제).
- 신뢰 설정: Gemini CLI는 trust=true 시 확인을 우회하므로, 기본은 trust=false를 권장하고, destructive 도구는 추가적으로 서버 측에서도 방어 로직을 둔다.
- (원격 트랜스포트 확장 시) SSE는 Origin 검증/localhost 바인딩/인증 구현 권고가 있으므로 v1 범위에서 제외하거나 별도 보안 요구사항으로 관리한다. [1]

## 5) 데이터/도구(API) 명세 + 수용 기준
Gemini CLI는 MCP 리소스를 @ 문법으로 참조하면 resources/read를 호출해 대화 컨텍스트로 주입할 수 있으므로, outbox/broadcast tail을 Resources로도 제공하는 것을 권장한다.

### 5.1 파일 구조(필수)
- .agents/agents/<agent_id>/meta.json
- .agents/agents/<agent_id>/inbox.jsonl
- .agents/agents/<agent_id>/outbox.jsonl
- .agents/run/<run_id>/broadcast.jsonl
- .agents/agents/<agent_id>/artifacts/

### 5.2 Tools (권장 최소)
오케스트레이터(마스터)용
- agent_create({name, role, cwd?, env?}) -> {agent_id, tmux_pane_id, paths}
- agent_get({agent_id}) -> {meta}
- agent_list({scope:"current_window"}) -> {agents:[...]}
- agent_delete({agent_id, force?:false}) -> {ok:true}
- task_enqueue({agent_id, task:{task_id, payload}}) -> {position:int}
- task_cancel({agent_id, task_id}) -> {ok:true, state:"cancel_requested"}
- events_read({agent_id, since_seq, max_events?}) -> {events:[...], last_seq}

서브에이전트용(allowlist 권장)
- wait_for_command({agent_id, timeout_ms, cursor?}) -> {status:"command"|"timeout", command?}
- emit_event({agent_id, task_id?, type, payload?, done?}) -> {ok:true}

### 5.3 Resources (권장)
- agent://<id>/outbox?tail=200
- run://<run_id>/broadcast?tail=200
- agent://<id>/meta

### 5.4 수용 기준(Acceptance Criteria)
- AC1 생성/준비: 마스터가 3개 에이전트 생성 시 현재 윈도우에 pane 3개가 split되고, 각 에이전트가 ready 이벤트를 1회 기록해야 한다.
- AC2 큐 처리: 한 에이전트에 task 10개 enqueue 시 FIFO 순서로 10개 terminal 이벤트를 outbox에 남기며, 동시 실행은 발생하지 않는다.
- AC3 long-poll: wait_for_command(timeout_ms=60000)는 60초 내 반드시 반환(timeout 또는 command)하고, 에이전트는 이를 반복 호출해 무한 루프를 구성한다.
- AC4 취소: running task cancel 요청 시 cancel_requested가 관측 가능하고, 에이전트는 체크포인트에서 canceled terminal 이벤트를 남긴다.
- AC5 stdio 준수: stdio 서버는 stdout에 MCP 메시지 외 출력이 없고(stderr/파일 로깅만), 위반 시 테스트에서 실패 처리한다. [1]
