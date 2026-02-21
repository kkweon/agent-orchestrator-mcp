// demo-supervisor.ts
import { AgentManager } from "./dist/agent-manager.js";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class FileWatcher {
    private cursor: number = 0;
    private path: string;

    constructor(filePath: string) {
        this.path = filePath;
    }

    async waitForEvent(eventType: string, timeoutMs: number = 30000): Promise<any> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                let content = "";
                try {
                    content = await fs.readFile(this.path, "utf-8");
                } catch {
                    await sleep(500);
                    continue;
                }
                const lines = content.split("\n").filter(l => l.trim());
                for (let i = this.cursor; i < lines.length; i++) {
                    try {
                        const event = JSON.parse(lines[i]);
                        if (event.type === eventType) {
                            this.cursor = i + 1; 
                            return event;
                        }
                    } catch (e) {}
                }
            } catch (e) {}
            await sleep(500);
        }
        throw new Error(`Timeout waiting for ${eventType} in ${this.path}`);
    }
}

async function main() {
  console.log("=== Supervisor Demo Started ===");
  const manager = new AgentManager();
  console.log(`[Supervisor] Session ID: ${manager.sessionId}`);

  const nodePath = process.execPath;
  const runnerPath = path.resolve(process.cwd(), "tests/mocks/mock-gemini.js");
  console.log(`[Supervisor] Using Runner: ${runnerPath}`);

  try {
      await fs.access(runnerPath);
  } catch {
      console.error(`Runner script not found at ${runnerPath}. Please run 'npm run build' first.`);
      process.exit(1);
  }

  const mockCommand = `"${nodePath}" "${runnerPath}" "${process.cwd()}"`;

  // 1. Create Worker
  console.log("\n[Supervisor] Spawning Worker (Role: worker)...");
  const worker = await manager.createAgent({
    name: "coder-bob",
    role: "worker",
    executablePath: mockCommand
  });
  console.log(`[Supervisor] Worker Created: ${worker.id}`);

  // 2. Create Verifier
  console.log("\n[Supervisor] Spawning Verifier (Role: verifier)...");
  const verifier = await manager.createAgent({
    name: "checker-alice",
    role: "verifier",
    executablePath: mockCommand
  });
  console.log(`[Supervisor] Verifier Created: ${verifier.id}`);

  try {
      const sessionDir = path.join(".agents", "sessions", manager.sessionId);
      const workerOutbox = path.join(sessionDir, "agents", worker.id, "outbox.jsonl");
      const verifierOutbox = path.join(sessionDir, "agents", verifier.id, "outbox.jsonl");

      const workerWatcher = new FileWatcher(workerOutbox);
      const verifierWatcher = new FileWatcher(verifierOutbox);

      // Wait for Ready
      console.log("\n[Supervisor] Waiting for agents to report ready...");
      
      try {
        const workerReady = await workerWatcher.waitForEvent("agent_ready");
        console.log(` -> Worker is Ready! (Role: ${workerReady.payload.role})`);
        
        const verifierReady = await verifierWatcher.waitForEvent("agent_ready");
        console.log(` -> Verifier is Ready! (Role: ${verifierReady.payload.role})`);
      } catch (e) {
        console.error("Agents failed to start.");
        throw e;
      }

      // 3. Assign Task to Worker
      console.log("\n[Supervisor] Assigning Task to Worker: 'Generate Hello World code'");
      const task1Id = await manager.enqueueTask(worker.id, { instruction: "Generate Hello World code" });
      console.log(` -> Task Enqueued: ${task1Id}`);

      // Wait for Result
      console.log("[Supervisor] Waiting for Worker result...");
      const workerResult = await workerWatcher.waitForEvent("task_completed");
      const generatedCode = workerResult.payload.output;
      console.log(`\n[Supervisor] Worker Result (Code):\n${generatedCode}`);

      // 4. Assign Task to Verifier
      console.log("\n[Supervisor] Assigning Task to Verifier: 'Review Code'");
      const task2Id = await manager.enqueueTask(verifier.id, { code: generatedCode });
      console.log(` -> Task Enqueued: ${task2Id}`);

      // Wait for Result
      console.log("[Supervisor] Waiting for Verifier result...");
      const verifierResult = await verifierWatcher.waitForEvent("task_completed");
      console.log(`\n[Supervisor] Verifier Result: ${verifierResult.payload.status}`);
      console.log(`[Supervisor] Comments: ${verifierResult.payload.comments}`);
  } finally {
      // 5. Cleanup
      console.log("\n[Supervisor] Mission Accomplished. Cleaning up...");
      await manager.deleteAgent(worker.id);
      await manager.deleteAgent(verifier.id);
      console.log("[Supervisor] Agents terminated.");
  }
}

main().catch(console.error);
