# Agent Orchestrator MCP Server

A **Model Context Protocol (MCP)** server that enables a master Gemini CLI agent to spawn, orchestrate, and manage multiple sub-agents within **tmux** sessions.

Designed for [OpenClaw](https://github.com/openclaw/openclaw) and Gemini CLI environments.

## Features

- **Tmux-based Isolation**: Each sub-agent runs in its own dedicated tmux pane.
- **Session Isolation**: Complete separation of workspaces and event logs per execution session.
- **Bi-directional Communication**: Master agent can send tasks; Sub-agents emit events (logs, results).
- **Auto-Inception**: Sub-agents are automatically prompted with their role and protocol upon startup.
- **Native Gemini CLI**: Sub-agents run actual `gemini` CLI instances with configurable models.

## Installation & Usage

You can run this MCP server directly using `npx`:

```bash
npx @kkweon/agent-orchestrator-mcp
```

### Configuration (gemini-extension.json)

To use this with Gemini CLI, add it to your extension configuration:

```json
{
  "mcpServers": {
    "orchestrator": {
      "command": "npx",
      "args": ["-y", "@kkweon/agent-orchestrator-mcp"]
    }
  }
}
```

## Tools

- **`agent_create`**: Spawn a new sub-agent in a split pane.
  - Params: `name`, `role`, `model` (optional)
- **`task_enqueue`**: Send a task to a specific sub-agent.
- **`agent_list`**: List active agents in the current session.
- **`agent_delete`**: Terminate a sub-agent and close its pane.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test
```

## License

MIT
