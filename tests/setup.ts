// tests/setup.ts
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export default async function globalSetup() {
    try {
        await execAsync("tmux kill-session -t openclaw-agents");
    } catch (e) {
        // ignore
    }
}
