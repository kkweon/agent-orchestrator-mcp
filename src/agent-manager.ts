// src/agent-manager.ts
import { Agent, Task, CreateAgentParams } from "./types.js";
import * as tmux from "./tmux.js";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Get directory of current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to get workspace root
const AGENTS_DIR = ".agents";

export class AgentManager {
  private workspaceRoot: string;
  public sessionId: string; // Expose sessionId for tests

  constructor(workspaceRoot: string = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
    this.sessionId = randomUUID(); // Generate unique session ID on startup
  }

  private getSessionDir(): string {
    return path.join(this.workspaceRoot, AGENTS_DIR, "sessions", this.sessionId);
  }

  private getAgentDir(agentId: string): string {
    return path.join(this.getSessionDir(), "agents", agentId);
  }

  private async ensureSessionDir() {
    await fs.mkdir(path.join(this.getSessionDir(), "agents"), { recursive: true });
    // broadcast.jsonl will be in getSessionDir()
  }

  async createAgent(params: CreateAgentParams): Promise<Agent> {
    await this.ensureSessionDir();
    const id = randomUUID();
    const agentDir = this.getAgentDir(id);
    await fs.mkdir(agentDir, { recursive: true });
    await fs.mkdir(path.join(agentDir, "artifacts"), { recursive: true });

    // Initialize files
    await fs.writeFile(path.join(agentDir, "inbox.jsonl"), "");
    await fs.writeFile(path.join(agentDir, "outbox.jsonl"), "");

    let context = await tmux.getCurrentTmuxContext();
    if (!context) {
      try {
         context = await tmux.createTmuxSession("openclaw-agents");
      } catch (e) {
         console.error("Warning: Could not determine tmux context", e);
         throw e;
      }
    }

    const pane = await tmux.splitPane(context.paneId, "horizontal", params.cwd);
    
    const agent: Agent = {
      id,
      name: params.name,
      role: params.role,
      tmuxPaneId: `${pane.sessionId}:${pane.windowId}:${pane.paneId}`,
      status: "created",
      queue: [],
      lastEventSeq: 0,
      createdAt: Date.now(),
      metadata: {},
    };

    await fs.writeFile(path.join(agentDir, "meta.json"), JSON.stringify(agent, null, 2));

    // Bootstrap Sub-agent: Inject Runner
    const runnerPath = params.runnerPath || path.resolve(__dirname, "../dist/agent-runner.js");
    
    // Check if runner exists (only if default is used)
    // If running from src (dev), it might be dist/src/agent-runner.js depending on build output
    // But usually 'npm run build' puts everything in dist/
    
    await tmux.sendKeys(pane.paneId, `export AGENT_ID=${id}`);
    await tmux.sendKeys(pane.paneId, `export AGENT_SESSION_ID=${this.sessionId}`);
    await tmux.sendKeys(pane.paneId, `echo "Starting Agent Runner..."`);
    // Run the node script
    await tmux.sendKeys(pane.paneId, `node "${runnerPath}"`);

    return agent;
  }

  async listAgents(): Promise<Agent[]> {
    await this.ensureSessionDir();
    // Only list agents in the current session
    const agentsDir = path.join(this.getSessionDir(), "agents");
    try {
        const dirs = await fs.readdir(agentsDir);
        const agents: Agent[] = [];
        for (const dir of dirs) {
            try {
                const meta = JSON.parse(await fs.readFile(path.join(agentsDir, dir, "meta.json"), "utf-8"));
                agents.push(meta);
            } catch (e) {
                // ignore invalid dirs
            }
        }
        return agents;
    } catch (e) {
        return [];
    }
  }

  async deleteAgent(id: string): Promise<void> {
    const agentDir = this.getAgentDir(id);
    try {
        const meta = JSON.parse(await fs.readFile(path.join(agentDir, "meta.json"), "utf-8"));
        const parts = meta.tmuxPaneId.split(":");
        const paneId = parts[2] || parts[0];
        await tmux.killPane(paneId);
    } catch (e) {
        // ignore
    }
    // We keep the dir for history/debugging for now.
  }

  async enqueueTask(agentId: string, taskPayload: any): Promise<string> {
    const agentDir = this.getAgentDir(agentId);
    const taskId = randomUUID();
    const taskEvent = {
        type: "task",
        taskId,
        payload: taskPayload,
        timestamp: Date.now()
    };
    
    // Check if agent dir exists (validating agent belongs to this session)
    try {
        await fs.access(agentDir);
    } catch {
        throw new Error(`Agent ${agentId} not found in session ${this.sessionId}`);
    }
    
    await fs.appendFile(path.join(agentDir, "inbox.jsonl"), JSON.stringify(taskEvent) + "\n");
    return taskId;
  }

  async waitForCommand(agentId: string, cursor: number = 0, timeoutMs: number = 10000): Promise<any> {
    const agentDir = this.getAgentDir(agentId);
    const inboxPath = path.join(agentDir, "inbox.jsonl");

    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
        try {
            const content = await fs.readFile(inboxPath, "utf-8");
            const lines = content.split("\n").filter(line => line.trim() !== "");
            
            if (lines.length > cursor) {
                // New command found
                const line = lines[cursor];
                const command = JSON.parse(line);
                return {
                    status: "command",
                    command,
                    next_cursor: cursor + 1
                };
            }
        } catch (e) {
            // file might not exist yet
        }
        
        // Wait a bit
        await new Promise(r => setTimeout(r, 500));
    }

    return { status: "timeout", next_cursor: cursor };
  }

  async emitEvent(agentId: string, event: any): Promise<void> {
    const agentDir = this.getAgentDir(agentId);
    const outboxPath = path.join(agentDir, "outbox.jsonl");
    const broadcastPath = path.join(this.getSessionDir(), "broadcast.jsonl");
    
    const entry = {
        ...event,
        agentId,
        timestamp: Date.now()
    };
    
    const line = JSON.stringify(entry) + "\n";
    await fs.appendFile(outboxPath, line);
    // Also append to session-scoped broadcast
    await fs.appendFile(broadcastPath, line);
  }
}
