import { Agent, Task, CreateAgentParams } from "./types.js";
import * as tmux from "./tmux.js";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Helper to get workspace root
// Assuming we run from workspace root or standard location
const AGENTS_DIR = ".agents";

export class AgentManager {
  private workspaceRoot: string;

  constructor(workspaceRoot: string = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
  }

  private getAgentDir(agentId: string): string {
    return path.join(this.workspaceRoot, AGENTS_DIR, "agents", agentId);
  }

  private async ensureAgentsDir() {
    await fs.mkdir(path.join(this.workspaceRoot, AGENTS_DIR, "agents"), { recursive: true });
    await fs.mkdir(path.join(this.workspaceRoot, AGENTS_DIR, "run"), { recursive: true });
  }

  async createAgent(params: CreateAgentParams): Promise<Agent> {
    await this.ensureAgentsDir();
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
         // Fallback if we can't create session (e.g. strict environment), 
         // but for this PRD we assume tmux is available.
         console.error("Warning: Could not determine tmux context", e);
         // proceed anyway? No, createAgent needs tmux.
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

    // Bootstrap Sub-agent
    // 1. Export ID
    await tmux.sendKeys(pane.paneId, `export AGENT_ID=${id}`);
    // 2. Start Agent Loop (Placeholder: just echo for now, or run a dummy loop)
    // The user will provide the actual instruction in the task, but we need the loop running.
    // Ideally we run `openclaw loop` or similar. 
    // For now: just echo.
    await tmux.sendKeys(pane.paneId, `echo "Agent ${id} ready. Run your agent loop here."`);

    return agent;
  }

  async listAgents(): Promise<Agent[]> {
    await this.ensureAgentsDir();
    const agentsDir = path.join(this.workspaceRoot, AGENTS_DIR, "agents");
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
    // Option: delete dir or archive it? PRD says delete agent. 
    // Usually better to move to archive, but for now strictly delete implies cleanup?
    // Let's keep the dir for history or delete it. PRD is silent on artifacts cleanup.
    // I'll leave the files for debugging.
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
    const broadcastPath = path.join(this.workspaceRoot, AGENTS_DIR, "run", "broadcast.jsonl");
    
    const entry = {
        ...event,
        agentId,
        timestamp: Date.now()
    };
    
    const line = JSON.stringify(entry) + "\n";
    await fs.appendFile(outboxPath, line);
    // Also append to global broadcast
    await fs.appendFile(broadcastPath, line); // simple append, race condition possible but acceptable for v1
  }
}
