// src/tmux.ts
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

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
  await execAsync(`tmux new-session -d -s ${sessionName} -x 800 -y 600`);
  const { stdout } = await execAsync(`tmux display-message -t ${sessionName} -p '#{session_id}:#{window_id}:#{pane_id}'`);
  const [sessionId, windowId, paneId] = stdout.trim().split(":");
  return { sessionId, windowId, paneId };
}

export async function splitPane(targetPaneId: string, direction: "horizontal" | "vertical" = "horizontal", cwd?: string): Promise<TmuxPane> {
  const flag = direction === "horizontal" ? "-h" : "-v";
  const cwdCmd = cwd ? `-c ${cwd}` : "";
  // Check available size before splitting (debugging)
  // const size = await execAsync(`tmux display-message -p -t ${targetPaneId} '#{pane_width}x#{pane_height}'`);
  // console.error(`Splitting pane ${targetPaneId} (Size: ${size.stdout.trim()})`);
  
  const { stdout } = await execAsync(`tmux split-window -d ${flag} -t ${targetPaneId} ${cwdCmd} -P -F '#{session_id}:#{window_id}:#{pane_id}'`);
  const [sessionId, windowId, paneId] = stdout.trim().split(":");
  return { sessionId, windowId, paneId };
}

export async function sendKeys(paneId: string, keys: string): Promise<void> {
  // Use single quotes to prevent the host shell from expanding variables (like $ or *)
  // We must escape existing single quotes in the command.
  const safeKeys = keys.replace(/'/g, "'\\''");
  await execAsync(`tmux send-keys -t ${paneId} '${safeKeys}' Enter`);
}

export async function capturePane(paneId: string, lines = 100): Promise<string> {
  const { stdout } = await execAsync(`tmux capture-pane -p -t ${paneId} -S -${lines}`);
  return stdout;
}

export async function killPane(paneId: string): Promise<void> {
  await execAsync(`tmux kill-pane -t ${paneId}`);
}
