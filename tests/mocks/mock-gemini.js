// tests/mocks/mock-gemini.js
const fs = require('fs');
const path = require('path');

// Simulate Gemini CLI environment
const AGENT_ID = process.env.AGENT_ID;
const SESSION_ID = process.env.AGENT_SESSION_ID;
// NOTE: CWD inside tmux pane might be different than test runner CWD. 
// However, AgentManager.createAgent uses `process.cwd()` (WORKSPACE_ROOT) if not provided.
// So the mock script should be running in WORKSPACE_ROOT.
const WORKSPACE_ROOT = process.cwd(); 

// Debug log to temp file
const debugLog = (msg) => {
    try {
        fs.appendFileSync('/tmp/mock-gemini.log', `[${new Date().toISOString()}] [${AGENT_ID}] ${msg}\n`);
    } catch {}
};

debugLog(`Started. CWD: ${process.cwd()} AGENT_ID: ${AGENT_ID} SESSION_ID: ${SESSION_ID}`);

if (!AGENT_ID || !SESSION_ID) {
  debugLog("Missing env vars, exiting.");
  process.exit(1);
}

// We need to resolve paths carefully.
// The AgentManager logic: path.join(this.workspaceRoot, AGENTS_DIR, "sessions", this.sessionId);
// workspaceRoot passed to AgentManager was WORKSPACE_ROOT (from test).
// So paths should align if CWD is correct.

const AGENT_DIR = path.join(WORKSPACE_ROOT, ".agents", "sessions", SESSION_ID, "agents", AGENT_ID);
const INBOX_PATH = path.join(AGENT_DIR, "inbox.jsonl");
const OUTBOX_PATH = path.join(AGENT_DIR, "outbox.jsonl");

debugLog(`AGENT_DIR: ${AGENT_DIR}`);

// Helper to append to outbox
function emitEvent(type, payload, taskId) {
  const event = {
    type,
    agentId: AGENT_ID,
    taskId,
    payload,
    timestamp: Date.now(),
  };
  try {
      fs.appendFileSync(OUTBOX_PATH, JSON.stringify(event) + "\n");
      debugLog(`Emitted: ${type}`);
  } catch (e) {
      debugLog(`Error emitting: ${e.message}`);
  }
}

async function main() {
  // Simulate initialization
  setTimeout(() => {
      debugLog("Emitting agent_ready");
      emitEvent("agent_ready", { role: "mock", model: "fake-v1" });
  }, 1000); // 1s delay

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
                    debugLog(`Processing Task: ${taskEvent.taskId}`);
                    
                    // 1. Acknowledge
                    emitEvent("task_started", { taskId: taskEvent.taskId }, taskEvent.taskId);
                    
                    // 2. Simulate Work
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
      debugLog(`Error loop: ${e.message}`);
    }
    // Sleep 200ms
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

main().catch(e => debugLog(`Fatal: ${e.message}`));
