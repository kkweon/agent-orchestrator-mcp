// tests/mocks/mock-gemini.js
const fs = require('fs');
const path = require('path');

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
function emitEvent(type, payload, taskId) {
  const event = {
    type,
    agentId: AGENT_ID,
    taskId,
    payload,
    timestamp: Date.now(),
  };
  fs.appendFileSync(OUTBOX_PATH, JSON.stringify(event) + "\n");
}

async function main() {
  console.log(`[Mock Gemini] Started for Agent ${AGENT_ID}`);
  
  // Parse args to support -i flag injection if needed (though we use file injection now)
  // But our mock just needs to emit ready.
  
  // Simulate initialization
  setTimeout(() => {
      emitEvent("agent_ready", { role: "mock", model: "fake-v1" });
  }, 500);

  let cursor = 0;

  // Simulate LLM Loop
  while (true) {
    try {
      if (fs.existsSync(INBOX_PATH)) {
          const content = fs.readFileSync(INBOX_PATH, "utf-8");
          const lines = content.split("\n").filter((line) => line.trim() !== "");

          if (lines.length > cursor) {
            for (let i = cursor; i < lines.length; i++) {
              try {
                  const taskEvent = JSON.parse(lines[i]);
                  if (taskEvent.type === "task") {
                    console.log(`[Mock Gemini] Processing Task: ${taskEvent.taskId}`);
                    
                    // 1. Acknowledge
                    emitEvent("task_started", { taskId: taskEvent.taskId }, taskEvent.taskId);
                    
                    // 2. Simulate Work
                    // Wait a bit then complete
                    setTimeout(() => {
                        emitEvent("task_completed", { 
                            status: "success", 
                            output: `Processed: ${taskEvent.payload.instruction || 'unknown'}`,
                            mocked: true 
                        }, taskEvent.taskId);
                    }, 500);
                  }
              } catch (e) {}
            }
            cursor = lines.length;
          }
      }
    } catch (e) {
      // Ignore read errors
    }
    // Sleep 200ms
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

main().catch(console.error);
