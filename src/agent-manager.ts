// src/agent-manager.ts
import { Agent, CreateAgentParams } from "./types.js";

/**
 * Shell-quote a string for safe interpolation into shell command strings.
 * Wraps in single quotes and escapes any embedded single quotes.
 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

type WaitForCommandResult =
  | { status: "command"; command: unknown; next_cursor: number }
  | { status: "timeout"; next_cursor: number };
import * as tmux from "./tmux.js";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";

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

  private getMasterInboxPath(): string {
    return path.join(this.getSessionDir(), "master_inbox.jsonl");
  }

  private async ensureSessionDir() {
    await fs.mkdir(path.join(this.getSessionDir(), "agents"), { recursive: true });
  }

  private async ensureMasterInboxDir() {
    await fs.mkdir(this.getSessionDir(), { recursive: true });
  }

  async createAgent(params: CreateAgentParams): Promise<Agent> {
    const id = randomUUID();
    const agentDir = this.getAgentDir(id);

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
      createdAt: Date.now(),
      metadata: {},
    };

    // Create the agent directory tree and initialize files.
    // Done after tmux pane creation to avoid race conditions in CI where
    // concurrent test cleanups might delete directories during the tmux spawn delay.
    await this.ensureSessionDir();
    await fs.mkdir(agentDir, { recursive: true });
    await fs.mkdir(path.join(agentDir, "artifacts"), { recursive: true });
    await fs.writeFile(path.join(agentDir, "inbox.jsonl"), "");
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
    const argsStr = args.map(shellQuote).join(" ");

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
3. Inside the loop, call the tool 'wait_for_command' with agent_id="${id}", cursor=current_cursor, timeout_ms=${DEFAULT_POLL_TIMEOUT_MS}.
   NOTE: 'agent_id' here is always YOUR agent ID ("${id}"). Do not change it.
4. If 'wait_for_command' returns a command (status="command"):
   a. Update your 'current_cursor' to the 'next_cursor' value returned.
   b. Execute the task described in the command using your capabilities.
   c. After execution, call the tool 'send_message' with:
        agent_id="${id}"  (always your own ID — this identifies the sender)
        message={ type: "task_completed", result: <your result> }
        target="master"
      to report back to the orchestrator.
5. If it times out (status="timeout"), retry the loop with the same 'current_cursor'. CRITICAL: Always keep looping — never terminate.

Start your loop now.
`.trim();

        // Write prompt to file to avoid escaping issues and race conditions
        const inceptionPath = path.join(agentDir, "inception.txt");
        await fs.writeFile(inceptionPath, inceptionPrompt);

        // Pass prompt as an argument using cat
        const safeInceptionPath = inceptionPath.replace(/'/g, "'\\''");
        cmd = `${shellQuote(executable)} -m ${shellQuote(model)} ${argsStr} "$(cat '${safeInceptionPath}')"`;
    }

    // Build optional env prefix from params.env (values are shell-quoted; keys must be valid identifiers)
    const VALID_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
    if (params.env) {
      for (const key of Object.keys(params.env)) {
        if (!VALID_ENV_KEY.test(key)) {
          throw new Error(`Invalid env key "${key}": must match [A-Za-z_][A-Za-z0-9_]*`);
        }
      }
    }
    const envPrefix = params.env
      ? Object.entries(params.env).map(([k, v]) => `${k}=${shellQuote(v)}`).join(" ") + " "
      : "";

    // We assume 'gemini' is in the PATH.
    const fullCmd = `${envPrefix}AGENT_ID=${id} AGENT_SESSION_ID=${this.sessionId} ${cmd}`;
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
        console.warn(`Could not kill tmux pane for agent ${id} (meta.json missing or corrupted).`);
    }
    // Always clean up the agent directory so the agent does not re-appear in listAgents()
    await fs.rm(agentDir, { recursive: true, force: true });
  }

  async sendMessage(
    fromId: string | "master",
    message: Record<string, unknown>,
    target: string | string[] | "master" | "all"
  ): Promise<void> {
    const entry = {
      ...message,
      from: fromId,
      timestamp: Date.now(),
    };
    const line = JSON.stringify(entry) + "\n";

    if (target === "master") {
      await this.ensureMasterInboxDir();
      await fs.appendFile(this.getMasterInboxPath(), line);
      return;
    }

    if (target === "all") {
      // Fan out to master inbox (unless sender is master) and all other agents' inboxes
      if (fromId !== "master") {
        await this.ensureMasterInboxDir();
        await fs.appendFile(this.getMasterInboxPath(), line);
      }
      const agents = await this.listAgents();
      await Promise.all(agents
        .filter(agent => agent.id !== fromId) // do not deliver to the sender's own inbox
        .map(agent =>
          fs.appendFile(path.join(this.getAgentDir(agent.id), "inbox.jsonl"), line).catch((e) => {
            console.error(`Failed to deliver message to agent ${agent.id} inbox:`, e);
          })
        )
      );
      return;
    }

    // target is a specific agent ID or array of agent IDs
    const targetIds = Array.isArray(target) ? target : [target];
    await Promise.all(targetIds.map(tid =>
      fs.appendFile(path.join(this.getAgentDir(tid), "inbox.jsonl"), line).catch((e) => {
        console.error(`Failed to deliver message to agent ${tid} inbox:`, e);
      })
    ));
  }

  async readInbox(
    agentId: string | "master",
    cursor: number = 0,
    limit?: number
  ): Promise<{ messages: Record<string, unknown>[]; next_cursor: number }> {
    const filePath = agentId === "master"
      ? this.getMasterInboxPath()
      : path.join(this.getAgentDir(agentId), "inbox.jsonl");

    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.error(`readInbox: unexpected error reading ${filePath}:`, e);
      }
      return { messages: [], next_cursor: cursor };
    }

    const lines = content.split("\n").filter(line => line.trim() !== "");

    if (cursor >= lines.length) {
      return { messages: [], next_cursor: cursor };
    }

    const slice = limit !== undefined ? lines.slice(cursor, cursor + limit) : lines.slice(cursor);
    const messages: Record<string, unknown>[] = [];
    for (const rawLine of slice) {
      try {
        messages.push(JSON.parse(rawLine) as Record<string, unknown>);
      } catch {
        console.error("readInbox: skipping malformed JSONL line:", rawLine);
      }
    }

    // next_cursor counts raw lines consumed (including any malformed ones that were skipped)
    return { messages, next_cursor: cursor + slice.length };
  }

  async waitForCommand(agentId: string, cursor: number = 0, timeoutMs: number = DEFAULT_POLL_TIMEOUT_MS): Promise<WaitForCommandResult> {
    const agentDir = this.getAgentDir(agentId);
    const inboxPath = path.join(agentDir, "inbox.jsonl");

    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        try {
            const content = await fs.readFile(inboxPath, "utf-8");
            const lines = content.split("\n").filter(line => line.trim() !== "");

            if (lines.length > cursor) {
                const rawLine = lines[cursor];
                try {
                    const command = JSON.parse(rawLine);
                    return {
                        status: "command",
                        command,
                        next_cursor: cursor + 1
                    };
                } catch {
                    // Malformed JSON at this cursor position — skip it and advance
                    console.error(`waitForCommand: skipping malformed JSONL line at cursor ${cursor}:`, rawLine);
                    cursor += 1;
                    continue; // re-check immediately without sleeping
                }
            }
        } catch (e: unknown) {
            const code = (e as NodeJS.ErrnoException).code;
            if (code !== "ENOENT") {
                console.error("waitForCommand: unexpected read error:", e);
            }
            // file might not exist yet — keep polling
        }

        await new Promise(r => setTimeout(r, 500));
    }

    return { status: "timeout", next_cursor: cursor };
  }
}
