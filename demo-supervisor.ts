// demo-supervisor.ts
import { AgentManager } from "./dist/agent-manager.js";
import path from "path";
import fs from "fs/promises";

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Scans master inbox starting from `cursor`, returning the first message matching
// agentId (via `from` or `agentId` field) and messageType.
// Returns the message and the next cursor position so callers can resume efficiently.
async function waitForMessageFromAgent(
  manager: any,
  agentId: string,
  messageType: string,
  startCursor: number = 0,
  timeoutMs: number = 30000
): Promise<{ msg: any; next_cursor: number }> {
  let cursor = startCursor;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await manager.readInbox("master", cursor);
    for (const msg of result.messages) {
      if ((msg.from === agentId || msg.agentId === agentId) && msg.type === messageType) {
        return { msg, next_cursor: result.next_cursor };
      }
    }
    cursor = result.next_cursor;
    await sleep(500);
  }
  throw new Error(`Timeout waiting for ${messageType} from agent ${agentId}`);
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
      // Wait for Ready (agents send agent_ready to master inbox)
      console.log("\n[Supervisor] Waiting for agents to report ready...");

      let masterCursor = 0;
      try {
        const { msg: workerReady, next_cursor: c1 } = await waitForMessageFromAgent(manager, worker.id, "agent_ready", masterCursor);
        masterCursor = c1;
        console.log(` -> Worker is Ready! (Role: ${workerReady.payload.role})`);

        const { msg: verifierReady, next_cursor: c2 } = await waitForMessageFromAgent(manager, verifier.id, "agent_ready", masterCursor);
        masterCursor = c2;
        console.log(` -> Verifier is Ready! (Role: ${verifierReady.payload.role})`);
      } catch (e) {
        console.error("Agents failed to start.");
        throw e;
      }

      // 3. Assign Task to Worker
      console.log("\n[Supervisor] Assigning Task to Worker: 'Generate Hello World code'");
      await manager.sendMessage("master", { instruction: "Generate Hello World code" }, worker.id);

      // Wait for Result
      console.log("[Supervisor] Waiting for Worker result...");
      const { msg: workerResult, next_cursor: c3 } = await waitForMessageFromAgent(manager, worker.id, "task_completed", masterCursor);
      masterCursor = c3;
      const generatedCode = workerResult.payload.output;
      console.log(`\n[Supervisor] Worker Result (Code):\n${generatedCode}`);

      // 4. Assign Task to Verifier
      console.log("\n[Supervisor] Assigning Task to Verifier: 'Review Code'");
      await manager.sendMessage("master", { code: generatedCode }, verifier.id);

      // Wait for Result
      console.log("[Supervisor] Waiting for Verifier result...");
      const { msg: verifierResult } = await waitForMessageFromAgent(manager, verifier.id, "task_completed", masterCursor);
      console.log(`\n[Supervisor] Verifier Result: ${verifierResult.payload.status}`);
      console.log(`[Supervisor] Output: ${verifierResult.payload.output}`);
  } finally {
      // 5. Cleanup
      console.log("\n[Supervisor] Mission Accomplished. Cleaning up...");
      await manager.deleteAgent(worker.id);
      await manager.deleteAgent(verifier.id);
      console.log("[Supervisor] Agents terminated.");
  }
}

main().catch(console.error);
