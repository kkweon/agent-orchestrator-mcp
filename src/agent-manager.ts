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
    // Check env var first (Sub-agent mode), else generate (Master mode)
    this.sessionId = process.env.AGENT_SESSION_ID || randomUUID(); 
  }

  private getSessionDir(): string {
    return path.join(this.workspaceRoot, AGENTS_DIR, "sessions", this.sessionId);
  }

  private getAgentDir(agentId: string): string {
    return path.join(this.getSessionDir(), "agents", agentId);
  }

  private async ensureSessionDir() {
    await fs.mkdir(path.join(this.getSessionDir(), "agents"), { recursive: true });
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
        // Not inside tmux? Check if our dedicated session exists.
        try {
            const existing = await tmux.getSessionContext("openclaw-agents");
            if (existing) {
                context = existing;
            } else {
                context = await tmux.createTmuxSession("openclaw-agents");
            }
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

    // 1. Prepare Environment
    await tmux.sendKeys(pane.paneId, `export AGENT_ID=${id}`);
    await tmux.sendKeys(pane.paneId, `export AGENT_SESSION_ID=${this.sessionId}`);
    
    // 2. Launch Gemini CLI (or Mock)
    // Model preference: params > env > default
    const model = params.model || process.env.GEMINI_MODEL || "auto";
    const executable = params.executablePath || "gemini";
    
    // Construct args
    let args = params.args || [];
    const argsStr = args.join(" ");
    
    let cmd = "";
    
    if (params.executablePath) {
        // If overriding executable (e.g. for testing), do not append model/args/prompt
        // Just run the executable as is.
        cmd = executable;
    } else {
        // Normal Gemini CLI execution
        // 3. Inject Inception Prompt (Brain Bootstrapping)
        const inceptionPrompt = `
You are a specialized sub-agent with ID "${id}" and Role "${params.role}".
Your goal is to autonomously process tasks from the orchestrator.

PROTOCOL:
1. Loop indefinitely.
2. Inside the loop, call the tool 'wait_for_command' with agent_id="${id}" and timeout_ms=30000.
3. If 'wait_for_command' returns a task, execute it using your capabilities.
4. After execution, call the tool 'emit_event' with agent_id="${id}" and type="task_completed" (include the result).
5. If it times out or fails, just retry the loop.

Start your loop now.
`.trim();

        // Write prompt to file to avoid escaping issues and race conditions
        const inceptionPath = path.join(agentDir, "inception.txt");
        await fs.writeFile(inceptionPath, inceptionPrompt);
        
        // Pass prompt as an argument using cat
        cmd = `${executable} -m ${model} ${argsStr} "$(cat '${inceptionPath}')"`;
    }
    
    // We assume 'gemini' is in the PATH.
    await tmux.sendKeys(pane.paneId, cmd);

    return agent;
  }

  async listAgents(): Promise<Agent[]> {
    await this.ensureSessionDir();
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
    await fs.appendFile(broadcastPath, line);
  }
}
