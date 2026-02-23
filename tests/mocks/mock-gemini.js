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

// Paths
const SESSION_DIR = path.join(WORKSPACE_ROOT, ".agents", "sessions", SESSION_ID);
const AGENT_DIR = path.join(SESSION_DIR, "agents", AGENT_ID);
const INBOX_PATH = path.join(AGENT_DIR, "inbox.jsonl");
const MASTER_INBOX_PATH = path.join(SESSION_DIR, "master_inbox.jsonl");

log(`AGENT_DIR: ${AGENT_DIR}`);
log(`MASTER_INBOX_PATH: ${MASTER_INBOX_PATH}`);

// Helper to send a message to master inbox (simulates send_message with target="master")
function sendToMaster(type, payload, taskId) {
  const event = {
    type,
    agentId: AGENT_ID,
    from: AGENT_ID,
    taskId,
    payload,
    timestamp: Date.now(),
  };
  log(`Sending to master: ${type}`);
  try {
      if (!fs.existsSync(SESSION_DIR)) {
          log(`CRITICAL: SESSION_DIR does not exist! ${SESSION_DIR}`);
          log("Attempting to recreate SESSION_DIR...");
          fs.mkdirSync(SESSION_DIR, { recursive: true });
      }
      fs.appendFileSync(MASTER_INBOX_PATH, JSON.stringify(event) + "\n");
      log(`Successfully wrote to master_inbox`);
  } catch (e) {
      log(`ERROR writing to master_inbox: ${e.message}`);
  }
}

// Initialize
log("Scheduling initial ready event...");
setTimeout(() => {
    log("Firing initial ready event now.");
    sendToMaster("agent_ready", { role: "mock", model: "fake-v1" });
}, 1000);

let cursor = 0;

// Loop — poll inbox for messages from master
setInterval(() => {
    try {
        if (fs.existsSync(INBOX_PATH)) {
            const content = fs.readFileSync(INBOX_PATH, "utf-8");
            const lines = content.split("\n").filter((line) => line.trim() !== "");

            if (lines.length > cursor) {
                log(`Found ${lines.length - cursor} new lines in inbox.`);
                for (let i = cursor; i < lines.length; i++) {
                    try {
                        const msg = JSON.parse(lines[i]);
                        log(`Processing message: ${JSON.stringify(msg)}`);

                        // Acknowledge receipt
                        sendToMaster("task_started", { taskId: msg.taskId }, msg.taskId);

                        // Process and complete
                        setTimeout(() => {
                            sendToMaster("task_completed", {
                                status: "success",
                                output: `Processed: ${msg.instruction || msg.payload?.instruction || 'unknown'}`,
                                mocked: true
                            }, msg.taskId);
                        }, 500);
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
