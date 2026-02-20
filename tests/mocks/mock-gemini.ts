// tests/mocks/mock-gemini.ts
import fs from "fs/promises";
import path from "path";

// Simulate Gemini CLI environment
const AGENT_ID = process.env.AGENT_ID;
const SESSION_ID = process.env.AGENT_SESSION_ID;
const WORKSPACE_ROOT = process.cwd(); 

if (!AGENT_ID || !SESSION_ID) {
  console.error("Mock Gemini: Missing AGENT_ID or AGENT_SESSION_ID");
  process.exit(1);
}

const AGENT_DIR = path.join(WORKSPACE_ROOT, ".agents", "sessions", SESSION_ID, "agents", AGENT_ID);
const INBOX_PATH = path.join(AGENT_DIR, "inbox.jsonl");
const OUTBOX_PATH = path.join(AGENT_DIR, "outbox.jsonl");

// Helper to append to outbox
async function emitEvent(type: string, payload: any, taskId?: string) {
  const event = {
    type,
    agentId: AGENT_ID,
    taskId,
    payload,
    timestamp: Date.now(),
  };
  await fs.appendFile(OUTBOX_PATH, JSON.stringify(event) + "\n");
}

async function main() {
  console.log(`[Mock Gemini] Started for Agent ${AGENT_ID}`);
  // Simulate initialization delay
  await new Promise(r => setTimeout(r, 500));
  
  await emitEvent("agent_ready", { role: "mock", model: "fake-v1" });

  let cursor = 0;

  // Simulate LLM Loop
  while (true) {
    try {
      const content = await fs.readFile(INBOX_PATH, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim() !== "");

      if (lines.length > cursor) {
        for (let i = cursor; i < lines.length; i++) {
          const taskEvent = JSON.parse(lines[i]);
          if (taskEvent.type === "task") {
            console.log(`[Mock Gemini] Processing Task: ${taskEvent.taskId}`);
            
            // 1. Acknowledge
            await emitEvent("task_started", { taskId: taskEvent.taskId }, taskEvent.taskId);
            
            // 2. Simulate Work (Think)
            await new Promise(r => setTimeout(r, 500));

            // 3. Complete
            await emitEvent("task_completed", { 
                status: "success", 
                output: `Processed: ${taskEvent.payload.instruction || 'unknown'}`,
                mocked: true 
            }, taskEvent.taskId);
          }
        }
        cursor = lines.length;
      }
    } catch (e) {
      // Ignore read errors
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

main().catch(console.error);
