#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { AgentManager } from "./agent-manager.js";
import { CreateAgentParams } from "./types.js";

const server = new Server(
  {
    name: "agent-orchestrator-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * Validates that an agent_id is either the special value "master" or a well-formed UUID.
 * Throws if the value does not match, preventing path traversal via directory names.
 */
function validateAgentId(id: string): void {
  if (id === "master") return;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`Invalid agent_id: "${id}"`);
  }
}

const agentManager = new AgentManager();

const TOOLS = [
  {
    name: "agent_create",
    description: "Create a new agent in a new tmux pane. After creating agents and sending messages, use read_inbox to monitor results.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        role: { type: "string" },
        model: { type: "string" },
        args: { type: "array", items: { type: "string" } },
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
    name: "send_message",
    description: "Send a message to one or more agents (or master). After sending a task to an agent, you MUST actively poll for their response by calling read_inbox(agent_id='master') repeatedly until they reply.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "Sender's agent ID (use 'master' if orchestrator is sending)" },
        message: { type: "object", description: "Message payload to send" },
        target: {
          oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
          description: "Routing: 'master' to send to orchestrator, 'all' to broadcast, an agent_id or [agent_ids] for targeted delivery."
        },
      },
      required: ["agent_id", "message", "target"],
    },
  },
  {
    name: "read_inbox",
    description: "Read messages from an inbox. Use agent_id='master' to read the orchestrator's inbox. IMPORTANT: This is non-blocking. If waiting for an agent's response, you MUST call this tool repeatedly in a loop (using the returned next_cursor) until the expected message arrives.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "Agent ID to read inbox for, or 'master' for the orchestrator inbox" },
        cursor: { type: "number", description: "Line index to resume from (default 0)" },
        limit: { type: "number", description: "Maximum number of messages to return" },
      },
      required: ["agent_id"],
    },
  },
  {
    name: "wait_for_command",
    description: "Internal: Agent polls for new commands from its inbox",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        timeout_ms: { type: "number" },
        cursor: { type: "number" },
      },
      required: ["agent_id", "timeout_ms", "cursor"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "agent_create") {
      const params = args as unknown as CreateAgentParams;
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
      const { agent_id } = args as Record<string, unknown>;
      validateAgentId(agent_id as string);
      await agentManager.deleteAgent(agent_id as string);
      return {
        content: [{ type: "text", text: `Agent ${agent_id} deleted` }],
      };
    }

    if (name === "send_message") {
      const { agent_id, message, target } = args as Record<string, unknown>;
      validateAgentId(agent_id as string);
      if (Array.isArray(target)) {
        (target as string[]).forEach(t => validateAgentId(t));
      } else if (typeof target === "string" && target !== "all") {
        validateAgentId(target);
      }
      await agentManager.sendMessage(
        agent_id as string,
        message as Record<string, unknown>,
        target as string | string[]
      );
      return {
        content: [{ type: "text", text: "ok" }],
      };
    }

    if (name === "read_inbox") {
      const { agent_id, cursor, limit } = args as Record<string, unknown>;
      validateAgentId(agent_id as string);
      const result = await agentManager.readInbox(
        agent_id as string,
        (cursor as number) ?? 0,
        limit as number | undefined
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    }

    if (name === "wait_for_command") {
      const { agent_id, timeout_ms, cursor } = args as Record<string, unknown>;
      validateAgentId(agent_id as string);
      const result = await agentManager.waitForCommand(agent_id as string, (cursor as number) ?? 0, timeout_ms as number);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
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
