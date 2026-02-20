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
  await execAsync(`tmux new-session -d -s ${sessionName}`);
  const { stdout } = await execAsync(`tmux display-message -t ${sessionName} -p '#{session_id}:#{window_id}:#{pane_id}'`);
  const [sessionId, windowId, paneId] = stdout.trim().split(":");
  return { sessionId, windowId, paneId };
}

export async function splitPane(targetPaneId: string, direction: "horizontal" | "vertical" = "horizontal", cwd?: string): Promise<TmuxPane> {
  const flag = direction === "horizontal" ? "-h" : "-v";
  const cwdCmd = cwd ? `-c ${cwd}` : "";
  const { stdout } = await execAsync(`tmux split-window -d ${flag} -t ${targetPaneId} ${cwdCmd} -P -F '#{session_id}:#{window_id}:#{pane_id}'`);
  const [sessionId, windowId, paneId] = stdout.trim().split(":");
  return { sessionId, windowId, paneId };
}

export async function sendKeys(paneId: string, keys: string): Promise<void> {
  await execAsync(`tmux send-keys -t ${paneId} "${keys}" Enter`);
}

export async function capturePane(paneId: string, lines = 100): Promise<string> {
  const { stdout } = await execAsync(`tmux capture-pane -p -t ${paneId} -S -${lines}`);
  return stdout;
}

export async function killPane(paneId: string): Promise<void> {
  await execAsync(`tmux kill-pane -t ${paneId}`);
}
