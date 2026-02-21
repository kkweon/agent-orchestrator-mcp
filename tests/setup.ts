// tests/setup.ts
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, "..");

const execAsync = promisify(exec);

export default async function globalSetup() {
    try {
        await execAsync("tmux kill-session -t openclaw-agents");
    } catch (e) {
        // ignore
    }
    // Remove any leftover .agents/ data from previous runs so all suites start fresh
    try {
        await fs.rm(path.join(WORKSPACE_ROOT, ".agents"), { recursive: true, force: true });
    } catch (e) {
        // ignore
    }
}
