// tests/mocks/mock-gemini.js
import fs from 'fs';
import path from 'path';

// NOTE: Use passed argument for workspace root if available, else CWD
const WORKSPACE_ROOT = process.argv[2] || process.cwd(); 

// Debug logging
const debugPath = path.join(WORKSPACE_ROOT, 'mock_debug.log');
const log = (msg) => {
    try {
        fs.appendFileSync(debugPath, `[${new Date().toISOString()}] ${msg}\n`);
    } catch (e) {}
};

log(`Started process ${process.pid}`);
log(`CWD: ${process.cwd()}`);
log(`ARGV: ${JSON.stringify(process.argv)}`);
log(`ENV AGENT_ID: ${process.env.AGENT_ID}`);
log(`ENV SESSION_ID: ${process.env.AGENT_SESSION_ID}`);

// Use AGENT_ID env var if present
const AGENT_ID = process.env.AGENT_ID;
const SESSION_ID = process.env.AGENT_SESSION_ID;

// Fallback logic for debugging if env vars are missing
if (!AGENT_ID || !SESSION_ID) {
    log("ERROR: Missing AGENT_ID or SESSION_ID");
    process.exit(1);
}

// Ensure .agents directory exists in CWD
const AGENT_DIR = path.join(WORKSPACE_ROOT, ".agents", "sessions", SESSION_ID, "agents", AGENT_ID);
const INBOX_PATH = path.join(AGENT_DIR, "inbox.jsonl");
const OUTBOX_PATH = path.join(AGENT_DIR, "outbox.jsonl");

log(`AGENT_DIR: ${AGENT_DIR}`);
log(`OUTBOX_PATH: ${OUTBOX_PATH}`);

// Helper to append to outbox
function emitEvent(type, payload, taskId) {
  const event = {
    type,
    agentId: AGENT_ID,
    taskId,
    payload,
    timestamp: Date.now(),
  };
  log(`Emitting event: ${type}`);
  try {
      if (!fs.existsSync(AGENT_DIR)) {
          log(`CRITICAL: AGENT_DIR does not exist! ${AGENT_DIR}`);
          const sessionDir = path.dirname(path.dirname(AGENT_DIR));
          try {
            if (fs.existsSync(sessionDir)) {
                log(`Session contents: ${fs.readdirSync(sessionDir).join(', ')}`);
            } else {
                log(`Session dir also missing: ${sessionDir}`);
            }
          } catch (e) { log(`Error listing dirs: ${e.message}`); }
          
          log("Attempting to recreate AGENT_DIR...");
          fs.mkdirSync(AGENT_DIR, { recursive: true });
      }
      fs.appendFileSync(OUTBOX_PATH, JSON.stringify(event) + "\n");
      log(`Successfully wrote to outbox`);
  } catch (e) {
      log(`ERROR writing to outbox: ${e.message}`);
  }
}

// Initialize
log("Scheduling initial ready event...");
setTimeout(() => {
    log("Firing initial ready event now.");
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
                log(`Found ${lines.length - cursor} new lines in inbox.`);
                for (let i = cursor; i < lines.length; i++) {
                    try {
                        const taskEvent = JSON.parse(lines[i]);
                        log(`Processing task: ${taskEvent.taskId}`);
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
                    } catch (e) {
                        log(`Error processing line ${i}: ${e.message}`);
                    }
                }
                cursor = lines.length;
            }
        }
    } catch (e) {
        log(`Error reading inbox: ${e.message}`);
    }
}, 200);

// Keep alive
setInterval(() => {}, 1000);
