// tests/mocks/mock-gemini.js
import fs from 'fs';
import path from 'path';

// NOTE: Use passed argument for workspace root if available, else CWD
const WORKSPACE_ROOT = process.argv[2] || process.cwd(); 

// Use AGENT_ID env var if present
const AGENT_ID = process.env.AGENT_ID;
const SESSION_ID = process.env.AGENT_SESSION_ID;

// Fallback logic for debugging if env vars are missing
if (!AGENT_ID || !SESSION_ID) {
    // Just exit silently or log error if possible.
    // Without ID, we can't write to the correct outbox.
    process.exit(1);
}

// Ensure .agents directory exists in CWD
const AGENT_DIR = path.join(WORKSPACE_ROOT, ".agents", "sessions", SESSION_ID, "agents", AGENT_ID);
const INBOX_PATH = path.join(AGENT_DIR, "inbox.jsonl");
const OUTBOX_PATH = path.join(AGENT_DIR, "outbox.jsonl");

// Use simple console log for debugging if needed, but stdout might be captured by tmux
// fs.appendFileSync('/tmp/mock-gemini-debug.log', `[${AGENT_ID}] Started in ${WORKSPACE_ROOT}\n`);

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
  } catch (e) {
      // ignore
  }
}

// Initialize
setTimeout(() => {
    emitEvent("agent_ready", { role: "mock", model: "fake-v1" });
}, 1000);

let cursor = 0;

// Loop
setInterval(() => {
    try {
        if (fs.existsSync(INBOX_PATH)) {
            const content = fs.readFileSync(INBOX_PATH, "utf-8");
            const lines = content.split("\n").filter((line) => line.trim() !== "");

            if (lines.length > cursor) {
                for (let i = cursor; i < lines.length; i++) {
                    try {
                        const taskEvent = JSON.parse(lines[i]);
                        if (taskEvent.type === "task") {
                            // Acknowledge
                            emitEvent("task_started", { taskId: taskEvent.taskId }, taskEvent.taskId);
                            
                            // Complete
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
    } catch (e) {}
}, 200);

// Keep alive
setInterval(() => {}, 1000);
