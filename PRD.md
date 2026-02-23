# Agent Orchestrator MCP Server PRD (v1.0)

## 1) 제품 개요 및 범위
본 제품은 Gemini CLI(마스터)가 MCP를 통해 tmux의 현재 윈도우에 여러 서브에이전트 Gemini CLI를 split-pane으로 생성하고, 작업을 큐로 분배하며, 결과를 JSONL 이벤트로 수집/브로드캐스트하는 “Agent Orchestrator MCP Server”다. Gemini CLI는 settings.json의 mcpServers에 등록된 MCP 서버를 발견하고, 도구(TOOLS) 실행 및 리소스(RESOURCES) 읽기를 수행한다.

### In-scope
- 로컬 tmux 기반 에이전트 생성/삭제/목록/상태 조회(CRUD)
- 에이전트별 비동기 메시징 (Actor 모델): inbox.jsonl 기반
- 서브에이전트 자율 루프: wait_for_command(timeout) 반복 호출(무한 블록 금지)
- 메시지 전달: send_message(target="master"|"all"|agent_id)
- **세션 격리(Session Isolation):** 각 실행 세션별로 독립적인 작업 공간 및 마스터 인박스 제공

### Out-of-scope (v1)
- tmux 없는 환경에서의 네이티브 실행(추후 백엔드 플러그인으로 확장)
- 에이전트 간 암묵적 “공유 메모리”(모든 공유는 명시적 파일/이벤트로만)

## 2) 사용자 여정(필수 플로우)
사용자는 마스터 Gemini CLI에서 “에이전트 N명(역할 포함) 생성”을 지시하면, MCP 서버가 현재 터미널이 속한 tmux 윈도우에 pane을 split 생성하고 각 pane에서 Gemini CLI를 실행한다. Gemini CLI는 MCP 서버의 도구를 자동 선택해 실행할 수 있으나, 서버 신뢰(trust) 설정에 따라 확인 프롬프트가 발생할 수 있으므로 운영 정책을 PRD에서 명시해야 한다.

- Setup: mcpServers에 서버 등록(command/url/httpUrl), /mcp에서 CONNECTED 및 Tools/Resources/Prompts 확인.
- Create: agent_create로 pane 생성 → 초기 지시사항 주입 → 서브에이전트가 wait_for_command 루프를 시작.
- Run: send_message로 작업 지시 전송 → 서브에이전트는 wait_for_command로 수신 → 작업 완료 후 send_message(target="master")로 결과 보고.
- Observe: read_inbox(agent_id="master")로 서브에이전트들의 응답/결과 참조.
- Recover: 에이전트 크래시/무응답 감지 → 재시작/재큐잉 정책에 따라 복구.

## 3) 기능 요구사항(가장 중요)

### 3.1 tmux 세션/윈도우 타겟팅
- R-TS1: “현재 터미널에서 실행 중인 마스터 Gemini CLI가 속한 tmux pane”을 기준으로, 같은 세션/같은 윈도우에만 에이전트 pane을 split 생성해야 한다.
- R-TS2: 사용자가 tmux 밖에서 실행 중이면, MCP 서버는 새 tmux 세션을 1회 생성하고 그 세션을 “현재 대상”으로 삼는다.
- R-TS3: 기존 사용자 pane은 삭제/이동/이름변경하지 않는다(에이전트 생성 시에만 현재 윈도우 레이아웃 조정 허용).

### 3.2 에이전트 CRUD
- R-AC1: agent_create는 (a) pane 생성, (b) Gemini CLI 실행, (c) 초기 지시사항 주입이 완료되어야 반환한다.
- R-AC2: agent_delete는 기본 graceful 종료(soft)이며, force kill은 별도 플래그/도구로 분리하고 확인이 필요하다.
- R-AC3: agent_list/agent_get은 최소로 다음을 제공해야 한다: agent_id, name, role, status, tmux_pane_id, createdAt.

### 3.3 Actor 모델 (메시지 기반 통신) — 확정
- R-Q1: 모든 통신은 비동기 메시지 교환으로 이루어진다. 각 에이전트는 자신만의 `inbox.jsonl`을 가진다.
- R-Q2: 마스터(오케스트레이터)는 자신만의 `master_inbox.jsonl`을 가지며, 에이전트들은 `send_message(target="master")`를 통해 보고한다.
- R-Q3: `send_message`는 단일 대상(agent_id), 다중 대상(Array), 혹은 특수 대상("master", "all")으로 전송할 수 있다.

### 3.4 서브에이전트 자율 루프(무인 운용) — 필수
- R-L1: 서브에이전트는 “무한 블록”이 아니라 wait_for_command(timeout_ms) long-poll 반복 호출로 명령을 수신한다.
- R-L2: 명령을 받으면 작업을 수행 → `send_message(target="master", message={type: "task_completed", ...})` → 다시 wait_for_command로 돌아간다.
- R-L3: 초기 지시사항에는 “루프 규약, Actor 모델 제약, artifacts 경로”가 반드시 포함되어야 한다.

### 3.5 메시지 관측 및 페이징 (Read Inbox)
- R-E1: 모든 인박스는 JSONL 파일이며 append-only이다.
- R-E2: `read_inbox` 도구는 `cursor`를 사용하여 효율적인 페이징 및 증분 읽기를 지원한다.
- R-E3: `cursor`는 읽은 라인 수(raw lines)를 의미하며, 다음 읽기 시 `next_cursor`를 넘겨주어 중복 읽기를 방지한다.

### 3.6 Gemini CLI MCP 권한 분리(권장 요구사항)
서브에이전트가 “마스터용 도구(에이전트 생성/삭제 등)”를 실수로 호출하지 않도록, Gemini CLI의 서버 설정에서 includeTools/excludeTools를 활용해 서브에이전트가 접근 가능한 도구를 제한하는 구성을 지원해야 한다. (예: 서브에이전트는 wait_for_command, send_message만 allowlist)

### 3.7 세션 격리(Session Isolation) — 신규 추가
- R-S1: MCP 서버 구동 시 고유한 `session_id` (UUID)를 생성한다.
- R-S2: 모든 에이전트 데이터와 마스터 인박스는 `.agents/sessions/<session_id>/` 하위에 격리하여 저장한다.
- R-S3: 서로 다른 세션(프로젝트)의 에이전트는 파일 시스템 레벨에서 분리되어 상호 간섭하지 않는다.

## 4) 비기능 요구사항(안정성/보안/운영)
Gemini CLI는 Stdio/SSE/Streamable HTTP 트랜스포트를 지원하므로, v1은 로컬 tmux 제어에 적합한 stdio를 기본으로 한다. stdio MCP 서버는 stdout에 MCP 메시지 외 내용을 출력하면 안 되며(stderr 로깅은 허용), 이 규칙을 위반하면 통신이 깨지므로 “로깅은 stderr/파일”을 필수 요구사항으로 둔다. [1]

### 4.1 성능/확장
- N=3 에이전트 생성 시간 목표(환경별): T초 이내(측정 방식 정의).
- 메시지 폴링: `read_inbox` 및 `wait_for_command`는 1초 내 응답(데이터가 있는 경우).

### 4.2 오류/복구
- Heartbeat: 에이전트는 주기적으로 메시지를 보낼 수 있으며, 마스터는 `read_inbox`를 통해 이를 확인한다.
- 재시작 정책: 프로세스 다운 감지 시 에이전트 재시작 정책에 따른다.
- 탄력성: JSONL 라인이 손상된 경우, 서버는 해당 라인을 건너뛰고 다음 유효한 메시지로 진행한다.

### 4.3 보안
- 파일 접근 루트 제한: .agents/ 및 프로젝트 루트만 접근(서버에서 강제).
- **ID 검증:** `agent_id` 파라미터는 엄격하게 검증(UUID 패턴)하여 상위 디렉토리 접근(Path Traversal)을 방지한다.
- **쉘 이스케이프:** tmux로 전달되는 모든 사용자 입력 및 환경 변수 값은 안전하게 쉘 이스케이프(`shellQuote`) 처리한다.

## 5) 데이터/도구(API) 명세 + 수용 기준

### 5.1 파일 구조(필수) — 격리 구조 적용
- .agents/sessions/<session_id>/master_inbox.jsonl
- .agents/sessions/<session_id>/agents/<agent_id>/meta.json
- .agents/sessions/<session_id>/agents/<agent_id>/inbox.jsonl
- .agents/sessions/<session_id>/agents/<agent_id>/inception.txt
- .agents/sessions/<session_id>/agents/<agent_id>/artifacts/

### 5.2 Tools (구현 완료)
오케스트레이터(마스터)용
- agent_create({name, role, model?, args?, cwd?, env?}) -> {agent_id, tmuxPaneId, ...}
- agent_list() -> Agent[]
- agent_delete({agent_id}) -> "ok"
- send_message({agent_id, message, target}) -> "ok"
- read_inbox({agent_id, cursor?, limit?}) -> {messages, next_cursor}

서브에이전트용(allowlist 권장)
- wait_for_command({agent_id, cursor?, timeout_ms}) -> {status, command?, next_cursor}
- send_message({agent_id, message, target:"master"}) -> "ok"

### 5.3 Resources (추후 확장)
- agent://<id>/inbox?cursor=0
- session://master/inbox?cursor=0
- agent://<id>/meta

### 5.4 수용 기준(Acceptance Criteria)
- AC1 생성/준비: 마스터가 에이전트 생성 시 현재 윈도우에 pane이 split되고, 에이전트가 `wait_for_command` 루프를 시작해야 한다.
- AC2 Actor 통신: `send_message`를 통해 마스터와 에이전트 간, 그리고 에이전트 간(broadcast 포함) 메시지가 누락 없이 전달되어야 한다.
- AC3 long-poll: `wait_for_command`는 데이터가 없을 때 timeout까지 대기하고, 데이터가 오면 즉시 반환해야 한다.
- AC4 보안: 잘못된 `agent_id` (예: "../../etc/passwd") 요청 시 즉시 거부되어야 하며, 특수문자가 포함된 환경 변수가 안전하게 전달되어야 한다.
- AC5 stdio 준수: stdio 서버는 stdout에 MCP 메시지 외 출력이 없고(stderr 로깅만), 위반 시 테스트에서 실패 처리한다.
