# Agent Orchestrator MCP Server

This is an MCP (Model Context Protocol) server that enables a "Master" agent (e.g., Gemini CLI) to orchestrate multiple sub-agents within `tmux` panes.

## Features

- **Tmux Integration**: Automatically splits the current tmux window to create panes for sub-agents.
- **Agent Management**: Create, list, and delete sub-agents.
- **Task Orchestration**: Enqueue tasks for specific agents.
- **Inter-Agent Communication**: Agents can emit events and poll for commands.

## Installation

```bash
npm install -g @kkweon/agent-orchestrator-mcp
```

## Configuration

Add this server to your MCP client configuration (e.g., `gemini-cli`'s `settings.json` or `mcpServers` config).

```json
{
  "mcpServers": {
    "agent-orchestrator": {
      "command": "agent-orchestrator-mcp",
      "args": [],
      "env": {}
    }
  }
}
```

## Tools

### `agent_create`
Create a new agent in a new tmux pane.
- `name` (string): Name of the agent.
- `role` (string): Role/instruction for the agent.
- `cwd` (string, optional): Working directory.

### `agent_list`
List all active agents managed by this server.

### `agent_delete`
Delete an agent and close its tmux pane.
- `agent_id` (string): The ID of the agent to delete.

### `task_enqueue`
Enqueue a task for an agent.
- `agent_id` (string): Target agent ID.
- `task` (object): Task payload.

### `wait_for_command` (Internal)
Used by sub-agents to poll for new commands/tasks.

### `emit_event` (Internal)
Used by sub-agents to report progress or results.

## Development

1. Clone the repository.
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Run locally: `npm start`
