# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript → dist/ (tsc + chmod +x)
npm test             # Run all tests (sequential, with experimental VM modules)
npm run dev          # Run via ts-node without building
npm start            # Run from compiled dist/
```

Run a single test file:
```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/agent-manager.test.ts --runInBand
```

## Architecture

This is an MCP (Model Context Protocol) server that lets a master Gemini CLI agent spawn and orchestrate sub-agents in tmux panes. It is published as `@kkweon/agent-orchestrator-mcp` and is designed to run via stdio.

### Source files (`src/`)

- **`index.ts`** — MCP server entry point. Registers tools with `@modelcontextprotocol/sdk`, routes `CallToolRequest` to `AgentManager`. Uses `StdioServerTransport`.
- **`agent-manager.ts`** — Core logic. `AgentManager` class handles all agent CRUD, message sending, and inbox reading using an Actor model. Uses file system for all persistence.
- **`tmux.ts`** — Thin wrappers around `tmux` CLI commands: `splitPane`, `sendKeys`, `killPane`, `killSession`, etc.
- **`types.ts`** — TypeScript interfaces: `Agent`, `CreateAgentParams`.

### Tool surface

**Master-agent tools**: `agent_create`, `agent_list`, `agent_delete`, `send_message`, `read_inbox`

**Sub-agent tools** (called by spawned agents): `wait_for_command`, `send_message`

### Session isolation & file layout

Each `AgentManager` instance generates a `sessionId` UUID at startup (or reads `AGENT_SESSION_ID` from the environment when running as a sub-agent). All data is scoped under:

```
.agents/sessions/<session_id>/
  master_inbox.jsonl                       # All events destined for the orchestrator
  agents/<agent_id>/
    meta.json                              # Agent state snapshot
    inbox.jsonl                            # Messages/commands for this agent (append-only)
    inception.txt                          # Bootstrap prompt injected on spawn
    artifacts/
```

### Sub-agent lifecycle

`agent_create` does:
1. Creates the file structure above
2. Determines tmux context (current pane or creates `openclaw-agents` session)
3. Splits a new tmux pane
4. Sends `AGENT_ID=<id> AGENT_SESSION_ID=<id> gemini -m <model> "$(cat inception.txt)"` to the pane

The inception prompt instructs the sub-agent to loop on `wait_for_command` (cursor-based, 30 min timeout), call `send_message` with `target="master"` to report results, and repeat.

`wait_for_command` polls `inbox.jsonl` every 500ms using a line index (cursor). `sendMessage` appends to the target's `.jsonl` file. `target="all"` fans out to every other agent's `inbox.jsonl` and the `master_inbox.jsonl`.

### Critical constraint: stdio protocol

**Never write to stdout.** The MCP transport uses stdout exclusively for protocol messages. All debug/info logging must go to `console.error` or a file. Violating this breaks the MCP connection.

## Testing

- **`tests/agent-manager.test.ts`** — Unit tests. Mocks `src/tmux.js` via `jest.unstable_mockModule`. Uses `.test-workspace/` as temp root.
- **`tests/e2e.test.ts`** — Integration test. Uses real tmux with `tests/mocks/mock-gemini.js` as a substitute for the Gemini CLI. Requires tmux to be installed.
- **`tests/mocks/mock-gemini.js`** — Node.js script that simulates a Gemini sub-agent: sends `agent_ready` on startup, polls `inbox.jsonl` and sends `task_completed` for each task to the master.
- Global setup/teardown (`tests/setup.ts` / `tests/teardown.ts`) kills the `openclaw-agents` tmux session to ensure a clean state.

Tests run with `--runInBand` (serial execution) because they share tmux session state.

## Key environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `AGENT_SESSION_ID` | Sub-agents | Identifies which session's data to read/write |
| `AGENT_ID` | Sub-agents | Agent's own UUID |
| `GEMINI_MODEL` | Master | Default model if not specified in `agent_create` (fallback: `gemini-3-flash-preview`) |
| `AGENT_POLL_TIMEOUT_MS` | Master/Sub-agents | `waitForCommand` timeout in ms (default: `1800000` = 30 min) |
