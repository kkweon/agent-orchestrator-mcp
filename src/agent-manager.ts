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

const DEFAULT_POLL_TIMEOUT_MS = parseInt(process.env.AGENT_POLL_TIMEOUT_MS || "1800000", 10) || 1800000;

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

    // Re-ensure the agent directory exists before writing meta.json.
    // The tmux session/pane creation above can take >200ms, during which CI
    // cleanup from other test suites may have removed the directory tree.
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(path.join(agentDir, "meta.json"), JSON.stringify(agent, null, 2));

    // 1. Prepare Environment
    // We pass AGENT_ID and AGENT_SESSION_ID inline with the command execution
    // to guarantee they are set correctly without relying on separate export commands.
    
    // 2. Launch Gemini CLI (or Mock)
    // Model preference: params > env > default
    const model = params.model || process.env.GEMINI_MODEL || "gemini-3-flash-preview";
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
1. Initialize a variable 'current_cursor' to 0.
2. Loop indefinitely. CRITICAL: Never exit the loop. Never stop polling.
3. Inside the loop, call the tool 'wait_for_command' with agent_id="${id}", cursor=current_cursor, and timeout_ms=${DEFAULT_POLL_TIMEOUT_MS}.
4. If 'wait_for_command' returns a task or command:
   a. Update your 'current_cursor' to the 'next_cursor' value returned.
   b. Execute the task using your capabilities.
   c. After execution, call the tool 'emit_event' with agent_id="${id}" and type="task_completed" (include the result). Optionally set target="master" to reply only to the orchestrator, target=<agent_id> to address a specific peer, or omit target to broadcast to all.
5. If it times out or fails, just retry the loop with the same 'current_cursor'. CRITICAL: Always keep looping — never terminate.

Start your loop now.
`.trim();

        // Write prompt to file to avoid escaping issues and race conditions
        const inceptionPath = path.join(agentDir, "inception.txt");
        await fs.writeFile(inceptionPath, inceptionPrompt);
        
        // Pass prompt as an argument using cat
        cmd = `${executable} -m ${model} ${argsStr} "$(cat '${inceptionPath}')"`;
    }
    
    // We assume 'gemini' is in the PATH.
    const fullCmd = `AGENT_ID=${id} AGENT_SESSION_ID=${this.sessionId} ${cmd}`;
    await tmux.sendKeys(pane.paneId, fullCmd);

    return agent;
  }

  async listAgents(): Promise<Agent[]> {
    await this.ensureSessionDir();
    const agentsDir = path.join(this.getSessionDir(), "agents");
    try {
        const dirs = await fs.readdir(agentsDir);
        const agents: Agent[] = [];
        for (const dir of dirs) {
            const metaPath = path.join(agentsDir, dir, "meta.json");
            try {
                await fs.access(metaPath);
                const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
                agents.push(meta);
            } catch (e) {
                // Skip directories that don't have meta.json yet or are corrupted
                console.warn(`Skipping agent directory ${dir}: meta.json not found or invalid`);
            }
        }
        return agents;
    } catch (e) {
        console.error("Failed to list agents:", e);
        return [];
    }
  }

  async deleteAgent(id: string): Promise<void> {
    const agentDir = this.getAgentDir(id);
    const metaPath = path.join(agentDir, "meta.json");
    try {
        await fs.access(metaPath);
        const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
        const parts = meta.tmuxPaneId.split(":");
        const paneId = parts[2] || parts[0];
        await tmux.killPane(paneId);
    } catch (e) {
        console.warn(`Could not delete agent ${id} cleanly (meta.json missing or corrupted).`);
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

  async waitForCommand(agentId: string, cursor: number = 0, timeoutMs: number = DEFAULT_POLL_TIMEOUT_MS): Promise<any> {
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

  async emitEvent(agentId: string, event: any, target?: string | string[]): Promise<void> {
    const agentDir = this.getAgentDir(agentId);
    const outboxPath = path.join(agentDir, "outbox.jsonl");
    const broadcastPath = path.join(this.getSessionDir(), "broadcast.jsonl");

    const entry = {
        ...event,
        agentId,
        timestamp: Date.now(),
        ...(target !== undefined ? { target } : {})
    };

    const line = JSON.stringify(entry) + "\n";
    // Always write to sender's outbox and session broadcast
    await fs.appendFile(outboxPath, line);
    await fs.appendFile(broadcastPath, line);

    // Routing: master-only → no peer inbox writes
    if (target === "master") {
        return;
    }

    try {
        // Targeted delivery to specific agent(s)
        if (target !== undefined && target !== "all") {
            const targetIds = Array.isArray(target) ? target : [target];
            for (const tid of targetIds) {
                if (tid !== agentId) {
                    const targetInboxPath = path.join(this.getAgentDir(tid), "inbox.jsonl");
                    await fs.appendFile(targetInboxPath, line).catch(() => {});
                }
            }
            return;
        }

        // Broadcast (target === "all" or omitted) — fan out to all other agents
        const agents = await this.listAgents();
        for (const agent of agents) {
            if (agent.id !== agentId) {
                const targetInboxPath = path.join(this.getAgentDir(agent.id), "inbox.jsonl");
                await fs.appendFile(targetInboxPath, line).catch(() => {});
            }
        }
    } catch (e) {
        console.error("Failed to deliver event to peer agents:", e);
    }
  }
}
