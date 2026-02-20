import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AgentManager } from "./agent-manager.js";

const server = new Server(
  {
    name: "agent-orchestrator-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

const agentManager = new AgentManager();

const TOOLS = [
  {
    name: "agent_create",
    description: "Create a new agent in a new tmux pane",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        role: { type: "string" },
        cwd: { type: "string" },
      },
      required: ["name", "role"],
    },
  },
  {
    name: "agent_list",
    description: "List all active agents",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "agent_delete",
    description: "Delete an agent and its tmux pane",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
      },
      required: ["agent_id"],
    },
  },
  {
    name: "task_enqueue",
    description: "Enqueue a task for an agent",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        task: { type: "object" },
      },
      required: ["agent_id", "task"],
    },
  },
  {
    name: "wait_for_command",
    description: "Internal: Agent polls for new commands",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        timeout_ms: { type: "number" },
        cursor: { type: "number" },
      },
      required: ["agent_id", "timeout_ms"],
    },
  },
  {
    name: "emit_event",
    description: "Internal: Agent emits an event (result/log)",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        event: { type: "object" },
      },
      required: ["agent_id", "event"],
    },
  }
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "agent_create") {
      const params = args as any;
      const agent = await agentManager.createAgent(params);
      return {
        content: [{ type: "text", text: JSON.stringify(agent, null, 2) }],
      };
    }

    if (name === "agent_list") {
      const agents = await agentManager.listAgents();
      return {
        content: [{ type: "text", text: JSON.stringify(agents, null, 2) }],
      };
    }

    if (name === "agent_delete") {
      const { agent_id } = args as any;
      await agentManager.deleteAgent(agent_id);
      return {
        content: [{ type: "text", text: `Agent ${agent_id} deleted` }],
      };
    }

    if (name === "task_enqueue") {
      const { agent_id, task } = args as any;
      const taskId = await agentManager.enqueueTask(agent_id, task);
      return {
        content: [{ type: "text", text: JSON.stringify({ task_id: taskId }) }],
      };
    }

    if (name === "wait_for_command") {
      const { agent_id, timeout_ms, cursor } = args as any;
      const result = await agentManager.waitForCommand(agent_id, cursor || 0, timeout_ms);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    }

    if (name === "emit_event") {
      const { agent_id, event } = args as any;
      await agentManager.emitEvent(agent_id, event);
      return {
        content: [{ type: "text", text: "ok" }],
      };
    }

    throw new Error(`Tool not found: ${name}`);
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Agent Orchestrator MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
