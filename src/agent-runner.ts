import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Configuration
const AGENT_ID = process.env.AGENT_ID;
const SESSION_ID = process.env.AGENT_SESSION_ID;
const WORKSPACE_ROOT = process.cwd(); // Assuming run from workspace root

if (!AGENT_ID || !SESSION_ID) {
  console.error("Missing AGENT_ID or AGENT_SESSION_ID env vars");
  process.exit(1);
}

const AGENT_DIR = path.join(WORKSPACE_ROOT, ".agents", "sessions", SESSION_ID, "agents", AGENT_ID);
const INBOX_PATH = path.join(AGENT_DIR, "inbox.jsonl");
const OUTBOX_PATH = path.join(AGENT_DIR, "outbox.jsonl");
const META_PATH = path.join(AGENT_DIR, "meta.json");

// Helper: Append to outbox
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

// Helper: Read Meta to get Role
async function getRole(): Promise<string> {
  try {
    const meta = JSON.parse(await fs.readFile(META_PATH, "utf-8"));
    return meta.role;
  } catch (e) {
    return "unknown";
  }
}

async function main() {
  const role = await getRole();
  console.log(`[Agent ${AGENT_ID}] Started. Role: ${role}`);
  await emitEvent("agent_ready", { role });

  let cursor = 0;

  while (true) {
    try {
      const content = await fs.readFile(INBOX_PATH, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim() !== "");

      if (lines.length > cursor) {
        // Process new tasks
        for (let i = cursor; i < lines.length; i++) {
          const taskEvent = JSON.parse(lines[i]);
          if (taskEvent.type === "task") {
            console.log(`[Agent ${AGENT_ID}] Received Task: ${taskEvent.taskId}`);
            await emitEvent("task_started", { taskId: taskEvent.taskId }, taskEvent.taskId);

            // Simulate Work based on Role
            await processTask(role, taskEvent);
          }
        }
        cursor = lines.length;
      }
    } catch (e) {
      // Ignore read errors (file might be busy or empty)
    }

    // Polling interval
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function processTask(role: string, taskEvent: any) {
  const { taskId, payload } = taskEvent;
  
  // Simulate thinking/working time
  await new Promise((resolve) => setTimeout(resolve, 2000));

  let resultPayload = {};

  if (role === "worker") {
    console.log(`[Worker] Generating code for: ${payload.instruction}`);
    resultPayload = {
      status: "success",
      output: `// Generated code for ${payload.instruction}\nconsole.log('Hello World');`,
    };
  } else if (role === "verifier") {
    console.log(`[Verifier] Reviewing code: ${payload.code}`);
    if (payload.code && payload.code.includes("Hello World")) {
      resultPayload = {
        status: "approved",
        comments: "LGTM! Code meets requirements.",
      };
    } else {
       resultPayload = {
        status: "rejected",
        comments: "Code is missing required 'Hello World'.",
      };
    }
  } else {
    resultPayload = { status: "unknown_role", message: "I don't know what to do." };
  }

  await emitEvent("task_completed", resultPayload, taskId);
  console.log(`[Agent ${AGENT_ID}] Task ${taskId} Completed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
