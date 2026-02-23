// src/tmux.ts
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Shell-quote a string for safe interpolation into tmux -t target arguments.
 * Wraps in single quotes and escapes any embedded single quotes.
 */
function tq(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export interface TmuxPane {
  sessionId: string;
  windowId: string;
  paneId: string;
}

export async function getCurrentTmuxContext(): Promise<TmuxPane | null> {
  try {
    const { stdout } = await execAsync("tmux display-message -p '#{session_id}:#{window_id}:#{pane_id}'");
    const [sessionId, windowId, paneId] = stdout.trim().split(":");
    return { sessionId, windowId, paneId };
  } catch (error) {
    return null; // Not inside tmux
  }
}

export async function createTmuxSession(sessionName: string): Promise<TmuxPane> {
  // Use -d to create detached session.
  // IMPORTANT: Set a large size explicitly to avoid "no space for new pane" errors in CI environments.
  // 80x24 is too small for splitting. Use 800x600.
  try {
    await execAsync(`tmux new-session -d -s ${tq(sessionName)} -x 800 -y 600`);
    // Give the server a moment to initialize in CI
    await new Promise(r => setTimeout(r, 200));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    const stderr = (e as { stderr?: string }).stderr || "";
    if (!msg.includes("duplicate session") && !stderr.includes("duplicate session")) {
        throw e;
    }
  }

  // Retry display-message a few times if it fails with "no server running"
  let lastError: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const { stdout } = await execAsync(`tmux display-message -t ${tq(sessionName)} -p '#{session_id}:#{window_id}:#{pane_id}'`);
      const [sessionId, windowId, paneId] = stdout.trim().split(":");
      return { sessionId, windowId, paneId };
    } catch (e: unknown) {
      lastError = e;
      if (e instanceof Error && e.message.includes("no server running")) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

export async function getSessionContext(sessionName: string): Promise<TmuxPane | null> {
  try {
    const { stdout } = await execAsync(`tmux display-message -t ${tq(sessionName)} -p '#{session_id}:#{window_id}:#{pane_id}'`);
    const [sessionId, windowId, paneId] = stdout.trim().split(":");
    return { sessionId, windowId, paneId };
  } catch (error) {
    return null;
  }
}

export async function splitPane(targetPaneId: string, direction: "horizontal" | "vertical" = "horizontal", cwd?: string): Promise<TmuxPane> {
  const flag = direction === "horizontal" ? "-h" : "-v";
  const cwdCmd = cwd ? `-c '${cwd.replace(/'/g, "'\\''")}'` : "";
  // Check available size before splitting (debugging)
  // const size = await execAsync(`tmux display-message -p -t ${targetPaneId} '#{pane_width}x#{pane_height}'`);
  // console.error(`Splitting pane ${targetPaneId} (Size: ${size.stdout.trim()})`);
  
  const { stdout } = await execAsync(`tmux split-window -d ${flag} -t ${tq(targetPaneId)} ${cwdCmd} -P -F '#{session_id}:#{window_id}:#{pane_id}'`);
  const [sessionId, windowId, paneId] = stdout.trim().split(":");
  return { sessionId, windowId, paneId };
}

export async function sendKeys(paneId: string, keys: string): Promise<void> {
  // Use single quotes to prevent the host shell from expanding variables (like $ or *)
  // We must escape existing single quotes in the command.
  const safeKeys = keys.replace(/'/g, "'\\''");
  // paneId originates from tmux's own #{pane_id} output which is always "%\d+" format,
  // so it is guaranteed safe for direct interpolation without additional quoting.
  // Add a small delay to ensure the shell prompt is ready.
  // This can help in environments where shell startup is slow.
  await execAsync(`tmux send-keys -t ${tq(paneId)} '${safeKeys}' Enter`);
  await new Promise(r => setTimeout(r, 100)); // 100ms delay
}

export async function capturePane(paneId: string, lines = 100): Promise<string> {
  const { stdout } = await execAsync(`tmux capture-pane -p -t ${tq(paneId)} -S -${lines}`);
  return stdout;
}

export async function killPane(paneId: string): Promise<void> {
  await execAsync(`tmux kill-pane -t ${tq(paneId)}`);
}

export async function killSession(sessionName: string): Promise<void> {
  try {
    await execAsync(`tmux kill-session -t ${tq(sessionName)}`);
  } catch (e) {
    // ignore if session doesn't exist
  }
}
